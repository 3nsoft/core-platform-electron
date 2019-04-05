/*
 Copyright (C) 2015 - 2018 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

import { shell } from 'electron';
import { SignUp, CreatedUser } from './sign-up';
import { IdManager } from './id-manager';
import { Storages } from './storage';
import { SignIn, StartInitWithoutCache, InitWithCache } from './sign-in';
import { ASMail } from './asmail';
import { makeDeviceFileOpener } from './device';
import { errWithCause } from '../lib-common/exceptions/error';
import { copy as jsonCopy } from '../lib-common/json-utils';
import { makeCryptor } from '../lib-client/cryptor/cryptor';
import { AppManifest, StoragePolicy, AppFSSetting, FSSetting, FilesOnDeviceSetting, FSChecker, DevPathChecker }
	from '../ui/app-settings';
import { AppInstance } from '../ui/app-instance';
import { makeChildOpener } from './child-app';
import { Subject } from 'rxjs';
import { appLog } from '../lib-client/logging/log-to-file';
import * as pathMod from 'path';

const ASMAIL_APP_NAME = 'computer.3nweb.core.asmail';
const MAILERID_APP_NAME = 'computer.3nweb.core.mailerid';

type FS = web3n.files.FS;

export interface CAPs {
	remotedW3N: any;
	close?: () => void;
	setAppInstance?: (app: AppInstance) => void;
};

export class Core {
	
	private cryptor = makeCryptor();
	private storages = new Storages(this.cryptor.cryptor.sbox);
	private asmail = new ASMail(this.cryptor.cryptor.sbox);
	private isInitialized = false;
	private isClosed = false;
	
	constructor(
		private viewerOpener: web3n.ui.OpenViewer
	) {
		Object.seal(this);
	}

	/**
	 * This method returns caps object for startup app, and a promise of core
	 * initialization.
	 * @param signUpUrl 
	 */
	start(signUpUrl: string):
			{ caps: CAPs, coreInit: Promise<void>; } {
		const signUp = new SignUp(signUpUrl, this.cryptor.cryptor);
		const signIn = new SignIn(
			this.cryptor.cryptor,
			this.initForExistingUserWithoutCache,
			this.initForExistingUserWithCache);
		
		const remotedW3N: web3n.startup.W3N = {
			signUp: signUp.exposedService(),
			signIn: signIn.exposedService()
		};
		const caps: CAPs = {
			remotedW3N: Object.freeze(remotedW3N)
		};
		Object.freeze(caps);

		const initFromSignUp$ = signUp.newUser$
		.flatMap(this.initForNewUser, 1);

		const initFromSignIn$ = signIn.existingUser$;

		const coreInit = initFromSignIn$
		.merge(initFromSignUp$)
		.take(1)
		.flatMap(idManager => this.initCore(idManager), 1)
		.toPromise();

		return { coreInit, caps };
	};

	private initForNewUser = async (u: CreatedUser): Promise<IdManager> => {
		// 1) init of id manager without setting fs
		const idManager = await IdManager.initInOneStepWithoutStore(
			u.address, u.midSKey.default);
		if (!idManager) { throw new Error(
			`Failed to provision MailerId identity`); }

		// 2) setup storage
		const storesUp = await this.storages.initFromRemote(
			u.address, idManager.getSigner, u.storeSKey);
		if (!storesUp) { throw new Error(`Stores failed to initialize`); }

		// 3) give id manager fs, in which it will record labeled key(s)
		await idManager.setStorages(
			await this.storages.makeLocalFSForApp(MAILERID_APP_NAME),
			await this.storages.makeSyncedFSForApp(MAILERID_APP_NAME),
			[ u.midSKey.labeled ]);

		return idManager;
	};

	private initForExistingUserWithoutCache: StartInitWithoutCache =
			async (address) => {
		// 1) init of id manager without setting fs
		const stepTwo = await IdManager.initWithoutStore(address);
		if (!stepTwo) { return; }
		return async (midLoginKey, storageKey) => {
			// 2) complete id manager login, without use of fs
			const idManager = await stepTwo(midLoginKey);
			if (!idManager) { return; }

			// 3) initialize all storages
			const storeDone = await this.storages.initFromRemote(
				address, idManager.getSigner, storageKey);
			if (!storeDone) { return; }

			// 4) complete initialization of id manager
			await idManager.setStorages(
				await this.storages.makeLocalFSForApp(MAILERID_APP_NAME),
				await this.storages.makeSyncedFSForApp(MAILERID_APP_NAME));
				
			return idManager;
		};
	};

	private initForExistingUserWithCache: InitWithCache =
			async (address, storageKey) => {
		const completeStorageInit = await this.storages.startInitFromCache(
			address, storageKey);
		if (!completeStorageInit) { return; }

		const idManager = await IdManager.initFromLocalStore(address,
			await this.storages.makeLocalFSForApp(MAILERID_APP_NAME));

		if (idManager) {
			const res = await completeStorageInit(idManager.getSigner);
			await idManager.setStorages(
				undefined,
				await this.storages.makeSyncedFSForApp(MAILERID_APP_NAME));
			return (res ? idManager : undefined);
		}

		return async (midLoginKey) => {
			const idManager = await IdManager.initInOneStepWithoutStore(
				address, midLoginKey);
			if (!idManager) { return; }
			const res = await completeStorageInit!(idManager.getSigner);
			await idManager.setStorages(
				await this.storages.makeLocalFSForApp(MAILERID_APP_NAME),
				await this.storages.makeSyncedFSForApp(MAILERID_APP_NAME));
			return (res ? idManager : undefined);
		};

	};

	// XXX this should also produce session, based on manifest
	makeCAPs = (appDomain: string, manifest: AppManifest): CAPs => {
		if (!this.isInitialized || this.isClosed) { throw new Error(
			`Core is either not yet initialized, or is already closed.`); }

		return makeCAPs(appDomain, manifest, this.storages.makeStorageCAP,
			this.asmail.makeASMailCAP, this.viewerOpener, this.openerWithOS);
	};

	private closeBroadcast = new Subject<void>();

	close$ = this.closeBroadcast.asObservable();

	async close(): Promise<void> {
		if (this.isClosed) { return; }
		if (this.isInitialized) {
			await this.asmail.close();
			await this.storages.close();
			this.asmail = (undefined as any);
			this.storages = (undefined as any);
		}
		this.cryptor.close();
		this.cryptor = (undefined as any);
		this.isClosed = true;
		this.closeBroadcast.next();
	}
	
	private async initCore(idManager: IdManager): Promise<void> {
		try {
			const inboxSyncedFS = await this.storages.makeSyncedFSForApp(
				ASMAIL_APP_NAME);
			const inboxLocalFS = await this.storages.makeLocalFSForApp(
				ASMAIL_APP_NAME);
			await this.asmail.init(idManager.getId(),
				idManager.getSigner, inboxSyncedFS, inboxLocalFS,
				this.storages.storageGetterForASMail());
			this.isInitialized = true;
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize core');
		}
	}

	private openerWithOS = async (fs: FS, path: string): Promise<boolean> => {
		const mountPath = await this.storages.mountOnDeviceFS(fs, path);
		return shell.openItem(mountPath);
	}

}
Object.freeze(Core.prototype);
Object.freeze(Core);

type StorageService = web3n.storage.Service;

export type StorageCAPMaker =
	(policy: StoragePolicy) => { remoteCAP: StorageService; close: () => void; };

type ASMailService = web3n.asmail.Service;

export type MailCAPMaker = () => ASMailService;

export function makeCAPs(appDomain: string, manifest: AppManifest,
		makeStorageCAP: StorageCAPMaker, makeASMailCAP: MailCAPMaker,
		viewerOpener: web3n.ui.OpenViewer,
		openerWithOSApp: web3n.ui.OpenWithOSApp): CAPs {

	if (appDomain !== manifest.appDomain) {
		throw new Error(`App manifest is for domain ${manifest.appDomain}, while app's domain is ${appDomain}`);
	}

	const remotedW3N: web3n.ui.W3N = {};
	const closeFns: (() => void)[] = [];
	const setAppInstanceFns: ((opener: AppInstance) => void)[] = [];

	addDeviceCAP(manifest, remotedW3N, closeFns, setAppInstanceFns);

	addLoggingCAP(manifest, remotedW3N);

	addChildOpeningCAP(manifest, remotedW3N, closeFns, setAppInstanceFns);

	addCloseSelfCAP(remotedW3N, setAppInstanceFns);

	addOpenViewerCAP(manifest, remotedW3N, viewerOpener);

	addOpenWithOSAppCAP(manifest, remotedW3N, openerWithOSApp);

	addOpenWithOSBrowserCAP(manifest, remotedW3N);
	
	addMailCAP(manifest, remotedW3N, closeFns, makeASMailCAP);

	addStorageCAP(manifest, remotedW3N, closeFns, makeStorageCAP);

	const caps: CAPs = { remotedW3N: Object.freeze(remotedW3N) };
	if (closeFns.length > 0) {
		caps.close = () => closeFns.map(f => f());
	}
	if (setAppInstanceFns.length > 0) {
		caps.setAppInstance = opener => setAppInstanceFns.map(f => f(opener));
	}
	return Object.freeze(caps);
}

function addOpenViewerCAP(manifest: AppManifest, remotedW3N: web3n.ui.W3N,
		viewerOpener: web3n.ui.OpenViewer): void {
	if (manifest.capsRequested.openViewer === 'all') {
		remotedW3N.openViewer = viewerOpener;
	}
}

function addOpenWithOSAppCAP(manifest: AppManifest, remotedW3N: web3n.ui.W3N,
		openerWithOSApp: web3n.ui.OpenWithOSApp) {
	if (manifest.capsRequested.openWithOSApp === 'all') {
		remotedW3N.openWithOSApp = openerWithOSApp;
	}
}

function addMailCAP(manifest: AppManifest, remotedW3N: web3n.ui.W3N,
		closeFns: (() => void)[], makeASMailCAP: MailCAPMaker): void {
	if (!manifest.capsRequested.mail) { return; }
	
	if ((manifest.capsRequested.mail.receivingFrom === 'all')
	&& (manifest.capsRequested.mail.sendingTo === 'all')) {
		remotedW3N.mail = makeASMailCAP();
	}
}

function addStorageCAP(manifest: AppManifest, remotedW3N: web3n.ui.W3N,
		closeFns: (() => void)[], makeStorageCAP: StorageCAPMaker): void {
	if (!manifest.capsRequested.storage) { return; }
	const { close, remoteCAP } = makeStorageCAP(makeStoragePolicy(manifest));
	remotedW3N.storage = remoteCAP;
	closeFns.push(close);
}

function addDeviceCAP(manifest: AppManifest,
		remotedW3N: web3n.ui.W3N, closeFns: (() => void)[],
		setAppInstanceFns: ((opener: AppInstance) => void)[]): void {
	if (!manifest.capsRequested.device) { return; }
	
	const caps = makeDeviceFileOpener();
	const device: typeof remotedW3N.device = {} as any;
	if (manifest.capsRequested.device.fileDialog === 'all') {
		device!.openFileDialog = caps.remotedCAP.openFileDialog;
		device!.saveFileDialog = caps.remotedCAP.saveFileDialog;
		device!.openFolderDialog = caps.remotedCAP.openFolderDialog;
		device!.saveFolderDialog = caps.remotedCAP.saveFolderDialog;
	}
	if (Object.keys(device!).length === 0) { return; }

	remotedW3N.device = device;
	closeFns.push(caps.close);
	setAppInstanceFns.push(caps.setAppInstance);
}

function addLoggingCAP(manifest: AppManifest, remotedW3N: web3n.ui.W3N): void {
	remotedW3N.log =
		(type: 'error'|'info'|'warning', m: string, e?: any) =>
			appLog(type, manifest.appDomain, m, e);
}

function addChildOpeningCAP(manifest: AppManifest,
		remotedW3N: web3n.ui.W3N, closeFns: (() => void)[],
		setAppInstanceFns: ((opener: AppInstance) => void)[]): void {
	if (manifest.capsRequested.openChildWindow !== 'all') { return; }
	
	const caps = makeChildOpener();
	remotedW3N.openChildWindow = caps.remotedCAP;
	closeFns.push(caps.close);
	setAppInstanceFns.push(caps.setAppInstance);
}

function addOpenWithOSBrowserCAP(manifest: AppManifest,
		remotedW3N: web3n.ui.W3N): void {
	if (manifest.capsRequested.openWithOSBrowser === 'all') {
		remotedW3N.openWithOSBrowser = url => {
			if (!url.startsWith('https://') || !url.startsWith('http://')) { return; }
			shell.openExternal(url);
		};
	}
}

function addCloseSelfCAP(remotedW3N: web3n.ui.W3N,
		setAppInstanceFns: ((app: AppInstance) => void)[]): void {
	let self: AppInstance = undefined as any;
	remotedW3N.closeSelf = () => self.window.close();
	setAppInstanceFns.push(app => { self = app; });
}

function makeStoragePolicy(manifest: AppManifest): StoragePolicy {
	if (!manifest.capsRequested.storage) { throw new Error(
		`Missing storage setting in app's manifest`); }
	const capReq = manifest.capsRequested.storage;

	let policy: StoragePolicy;
	if (capReq.appFS === 'default') {
		policy = {
			canOpenAppFS: singleDomainAppFSChecker({
				domain: manifest.appDomain,
				storage: 'synced-n-local'
			})
		};
	} else if (Array.isArray(capReq.appFS)) {
		const okDomains = capReq.appFS
		.filter(fsInfo => fsInfo.domain.endsWith(manifest.appDomain))
		.map(fsInfo => jsonCopy(fsInfo));
		policy = {
			canOpenAppFS: severalDomainsAppFSChecker(okDomains)
		};
	} else {
		policy = {
			canOpenAppFS: noFS
		};
	}

	if (capReq.userFS) {
		if (capReq.userFS === 'all') {
			policy.canOpenUserFS = allFSs;
		} else if (Array.isArray(capReq.userFS)) {
			policy.canOpenUserFS = fsChecker(capReq.userFS);
		}
	}

	if (capReq.sysFS) {
		if (capReq.sysFS === 'all') {
			policy.canOpenSysFS = allFSs;
		} else if (Array.isArray(capReq.sysFS)) {
			policy.canOpenSysFS = fsChecker(capReq.sysFS);
		}
	}

	if (Array.isArray(capReq.filesOnDevice)) {
		policy.canAccessDevicePath = devPathChecker(capReq.filesOnDevice);
	}

	return Object.freeze(policy);
}

type AppFSChecker = (appFolder: string, type: 'local'|'synced') => boolean;

const noFS: AppFSChecker = () => false;

export function reverseDomain(domain: string): string {
	return domain.split('.').reverse().join('.');
}

function singleDomainAppFSChecker(appFS: AppFSSetting): AppFSChecker {
	const revDomain = reverseDomain(appFS.domain);
	const allowedType = appFS.storage;
	return (appFolder: string, type: 'local'|'synced'): boolean => {
		return (appFSTypeAllowed(allowedType, type) && (appFolder === revDomain));
	};
}

function appFSTypeAllowed(allowed: 'synced' | 'local' | 'synced-n-local',
		type: 'synced' | 'local'): boolean {
	if (type === 'local') {
		if (allowed === 'synced-n-local') { return true; }
		if (allowed === 'local') { return true; }
	} else if (type === 'synced') {
		if (allowed === 'synced-n-local') { return true; }
		if (allowed === 'synced') { return true; }
	}
	return false;
}

function severalDomainsAppFSChecker(appFSs: AppFSSetting[]): AppFSChecker {
	appFSs.forEach(appFS => {
		appFS.domain = reverseDomain(appFS.domain);
	})
	return (appFolder: string, type: 'local'|'synced'): boolean => {
		return !!appFSs.find(appFS => ((appFS.domain === appFolder) &&
			appFSTypeAllowed(appFS.storage, type)));
	};
}

const allFSs: FSChecker = () => 'w';

function fsChecker(setting: FSSetting[]): FSChecker {
	return (type: web3n.storage.StorageType) => {
		const s = setting.find(s => (s.type === type));
		if (!s) { return false; }
		return (s.writable ? 'w' : 'r');
	};
}

function devPathChecker(setting: FilesOnDeviceSetting[]): DevPathChecker {
	const s = setting.map(p => {
		const devPath: FilesOnDeviceSetting = {
			writable: p.writable,
			path: pathMod.normalize(p.path)
		};
		return devPath;
	});
	return (path: string) => {
		if (!pathMod.isAbsolute(path)) { return false; }
		const entry = s.find(p => {
			if (p.path === '*') {
				return true;
			} else if (path.startsWith(p.path)) {
				const relPath = pathMod.relative(p.path, path);
				const pathInTree = !relPath.startsWith(`..${pathMod.sep}`);
				return pathInTree;
			} else {
				return false;
			}
		});
		if (!entry) { return false; }
		return (entry.writable ? 'w' : 'r');
	};
}

Object.freeze(exports);