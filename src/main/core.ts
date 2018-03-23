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
import { SignUp } from './signup';
import { makeManager } from './id-manager';
import { Storages } from './storage/index';
import { SignIn, GenerateKey } from './sign-in';
import { ASMail } from './asmail/index';
import { makeDeviceFileOpener } from './device';
import { bind } from '../lib-common/binding';
import { errWithCause } from '../lib-common/exceptions/error';
import { copy as jsonCopy } from '../lib-common/json-utils';
import { makeCryptor } from '../lib-client/cryptor/cryptor';
import { AppManifest, StoragePolicy, AppFSSetting, FSSetting }
	from '../ui/app-settings';
import { AppInstance } from '../ui/app-instance';
import { makeChildOpener } from './child-app';
import { Subject, Observable } from 'rxjs';
import { appLog } from '../lib-client/logging/log-to-file';

const ASMAIL_APP_NAME = 'computer.3nweb.core.asmail';
const MAILERID_APP_NAME = 'computer.3nweb.core.mailerid';

type FS = web3n.files.FS;
type File = web3n.files.File;

export interface CAPs {
	remotedW3N: any;
	close?: () => void;
	setAppInstance?: (app: AppInstance) => void;
};

export class Core {
	
	private idManager = makeManager();
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
	 * This method returns caps object for startup app, and an observable
	 * of core initialization event.
	 * @param signUpUrl 
	 */
	start(signUpUrl: string):
			{ caps: CAPs, coreInit$: Observable<void>; } {
		const signUp = new SignUp(signUpUrl,
			this.cryptor.cryptor,
			this.idManager,
			bind(this, this.initStorageFromRemote));
		const signIn = new SignIn(
			this.cryptor.cryptor,
			this.idManager,
			bind(this, this.initStorageFromRemote),
			bind(this, this.initExistingStorage));
		
		const remotedW3N: web3n.startup.W3N = {
			signUp: signUp.wrap(),
			signIn: signIn.wrap()
		};
		const caps: CAPs = {
			remotedW3N: Object.freeze(remotedW3N)
		};
		Object.freeze(caps);

		const coreInit$ = signIn.done$
		.merge(signUp.done$)
		.take(1)
		.flatMap(() => this.initCore(), 1);

		return { coreInit$, caps };
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
	
	private initExistingStorage(user: string,
			genMasterCrypt: GenerateKey): Promise<boolean> {
		return this.storages.initExisting(
			user, this.idManager.getSigner, genMasterCrypt);
	}
	
	private initStorageFromRemote(generateKey: GenerateKey): Promise<boolean> {
		return this.storages.initFromRemote(
			this.idManager.getId(), this.idManager.getSigner, generateKey);
	}
	
	private async initCore(): Promise<void> {
		try {
			const mailerIdFS = await this.storages.makeSyncedFSForApp(
				MAILERID_APP_NAME);
				mailerIdFS.type
			await this.idManager.setStorage(mailerIdFS);

			const inboxSyncedFS = await this.storages.makeSyncedFSForApp(
				ASMAIL_APP_NAME);
			const inboxLocalFS = await this.storages.makeLocalFSForApp(
				ASMAIL_APP_NAME);
			await this.asmail.init(this.idManager.getId(),
				this.idManager.getSigner, inboxSyncedFS, inboxLocalFS,
				this.storages.storageGetterForASMail());
			this.isInitialized = true;
			this.storages.startSyncOfFilesInCache();
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

type FSChecker = (type: web3n.storage.StorageType) => 'w'|'r'|false;

const allFSs: FSChecker = () => 'w';

function fsChecker(setting: FSSetting[]): FSChecker {
	return (type: web3n.storage.StorageType) => {
		const s = setting.find(s => (s.type === type));
		if (!s) { return false; }
		return (s.writable ? 'w' : 'r');
	};
}

Object.freeze(exports);