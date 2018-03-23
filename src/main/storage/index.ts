/*
 Copyright (C) 2015 - 2017 3NSoft Inc.
 
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

import { GetSigner } from '../id-manager';
import { GenerateKey } from '../sign-in';
import { SyncedStorage, Storage, StorageGetter }
	from '../../lib-client/3nstorage/xsp-fs/common';
import { XspFS as xspFS } from '../../lib-client/3nstorage/xsp-fs/fs';
import { StorageException as BaseExc }
	from '../../lib-client/3nstorage/exceptions';
import { makeStorageFS } from '../../lib-client/local-files/app-files';
import { makeSyncedStorage } from './synced/storage';
import { makeLocalStorage } from './local/storage';
import { getStorageServiceFor } from '../../lib-client/service-locator';
import { bind } from '../../lib-common/binding';
import { ScryptGenParams } from '../../lib-client/key-derivation';
import { FileException, makeFileException, Code as excCode }
	from '../../lib-common/exceptions/file';
import { StoragePolicy } from '../../ui/app-settings';
import { AsyncSBoxCryptor } from 'xsp-files';
import { makeFSCollection, readonlyWrapFSCollection }
	from '../../lib-client/fs-collection';
import { asyncFind } from '../../lib-common/async-iter';
import { DeviceFS } from '../../lib-client/local-files/device-fs';

type EncryptionException = web3n.EncryptionException;
type WritableFS = web3n.files.WritableFS;
type FS = web3n.files.FS;
type FSType = web3n.files.FSType;
type StorageType = web3n.storage.StorageType;
type FSCollection = web3n.files.FSCollection;
type FSItem = web3n.files.FSItem;

export interface StorageException extends BaseExc {
	appName?: string;
	badAppName?: boolean;
	notAllowedToOpenFS?: boolean;
	storageType?: StorageType;
	storageSegment: 'app'|'system'|'user';
}

function makeBadAppNameExc(appName: string): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'app',
		badAppName: true,
		appName
	};
}

function makeNotAllowedToOpenAppFSExc(appName: string): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'app',
		notAllowedToOpenFS: true,
		appName
	};
}

function makeNotAllowedToOpenUserFSExc(storageType: StorageType):
		StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'user',
		notAllowedToOpenFS: true,
		storageType
	};
}

function makeNotAllowedToOpenSysFSExc(storageType: StorageType):
		StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'system',
		notAllowedToOpenFS: true,
		storageType
	};
}

const CORE_APPS_PREFIX = 'computer.3nweb.core';
export const STORAGE_APP = 'computer.3nweb.storage';

const KD_PARAMS_FILE_NAME = 'kd-params';
const LOCAL_STORAGE_DIR = 'local';
const SYNCED_STORAGE_DIR = 'synced';

async function getRootKeyDerivParams(fs: WritableFS,
		getFromServer: () => Promise<ScryptGenParams>): Promise<ScryptGenParams> {
	return fs.readJSONFile<ScryptGenParams>(KD_PARAMS_FILE_NAME).catch(
		async (exc: FileException) => {
			if (!exc.notFound) { throw exc; }
			const params = await getFromServer();
			await fs.writeJSONFile(KD_PARAMS_FILE_NAME, params);
			return params;
	});
}

export const sysFolders = {
	appData: 'Apps Data',
	apps: 'Apps Code',
	sharedLibs: 'Shared Libs',
	userFiles: 'User Files'
};
Object.freeze(sysFolders);

/**
 * This function creates initial folder structure in a given root.
 * @param root 
 */
export async function initSysFolders(root: WritableFS): Promise<void> {
	for (const sysFolder of Object.values(sysFolders)) {
		await root.makeFolder(sysFolder);
	}
}

class StorageAndFS<T extends Storage> {
	
	rootFS: WritableFS = (undefined as any);
	
	constructor(
			public storage: T) {
		Object.seal(this);
	}

	async initExisting(key: Uint8Array): Promise<boolean> {
		try {
			this.rootFS = await xspFS.makeExisting(this.storage, key);
			return true;
		} catch (err) {
			if ((err as EncryptionException).failedCipherVerification) {
				return false;
			} else {
				throw err;
			}
		}
	}

	async initFromRemote(key: Uint8Array): Promise<boolean> {
		try {
			this.rootFS = await xspFS.makeExisting(this.storage, key);
		} catch (err) {
			if ((err as StorageException).objNotFound) {
				this.rootFS = await xspFS.makeNewRoot(this.storage, key);
				await initSysFolders(this.rootFS);
			} else if ((err as EncryptionException).failedCipherVerification) {
				return false;
			} else {
				throw err;
			}
		}
		return true;
	}
	
	makeAppFS(appFolder: string): Promise<WritableFS> {
		if (('string' !== typeof appFolder) ||
				(appFolder.length === 0) ||
				(appFolder.indexOf('/') >= 0)) {
			throw makeBadAppNameExc(appFolder);
		}
		if (!this.rootFS) { throw new Error('Storage is not initialized.'); }
		return this.rootFS.writableSubRoot(`${sysFolders.appData}/${appFolder}`);
	}

	userFS(): Promise<WritableFS> {
		return this.rootFS.writableSubRoot(sysFolders.userFiles);
	}

	async sysFSs(): Promise<FSCollection> {
		const c = makeFSCollection();
		for (let fsName of [ sysFolders.appData,
				sysFolders.apps, sysFolders.sharedLibs ]) {
			await c.set!(fsName, {
				isFolder: true,
				item: await this.rootFS.writableSubRoot(fsName)
			});
		}
		return c;
	}

	async close(): Promise<void> {
		if (!this.rootFS) { return; }
		await this.rootFS.close();
		await this.storage.close();
		this.rootFS = (undefined as any);
		this.storage = (undefined as any);
	}
}

type File = web3n.files.File;

export class Storages implements FactoryOfAppFSs {

	startSyncOfFilesInCache: () => void = (undefined as any);
	
	private synced: StorageAndFS<SyncedStorage> = (undefined as any);
	
	private local: StorageAndFS<Storage> = (undefined as any);

	private preCloseWaits = new Set<Promise<void>>();

	constructor(
			private cryptor: AsyncSBoxCryptor) {
		Object.seal(this);
	}

	makeStorageCAP = (policy: StoragePolicy):
			{ remoteCAP: StorageService; close: () => void; } => {
		return (new PerWinStorage(this, policy)).wrap();
	}

	addPreCloseWait(wait: Promise<void>): void {
		const detachWait = () => {
			this.preCloseWaits.delete(promise);
		};
		const promise = wait.then(detachWait, detachWait);
		this.preCloseWaits.add(promise);
	}

	storageGetterForASMail(): StorageGetter {
		return (type: FSType, location?: string): Storage => {
			if (type === 'share') {
				// TODO implement returning shared storage
				throw new Error(`Providing shared storage is not implemented, yet`);
			} else {
				throw new Error(`Cannot provide ${type} storage via asmail message storage`);
			}
		};
	}
	
	/**
	 * This does an initial part of initialization, common to both initialization
	 * scenarios.
	 * @param user
	 * @param getSigner
	 * @param generateMasterKey
	 */
	private async initFst(user: string, getSigner: GetSigner,
			generateMasterKey: GenerateKey): Promise<Uint8Array> {
		const storageFS = await makeStorageFS(user);
		if (!this.synced) {
			const { startSyncOfFilesInCache, store } = await makeSyncedStorage(
				user, getSigner,
				await storageFS.writableSubRoot(SYNCED_STORAGE_DIR),
				() => getStorageServiceFor(user),
				this.storageGetterForSyncedStorage(),
				this.cryptor);
			this.synced = new StorageAndFS(store);
			this.startSyncOfFilesInCache = startSyncOfFilesInCache;
		}
		if (!this.local) {
			this.local = new StorageAndFS(await makeLocalStorage(
				await storageFS.writableSubRoot(LOCAL_STORAGE_DIR),
				this.storageGetterForLocalStorage(),
				this.cryptor));
		}
		const params = await getRootKeyDerivParams(storageFS,
			this.synced.storage.getRootKeyDerivParamsFromServer);
		return await generateMasterKey(params);
	}

	private storageGetterForLocalStorage(): StorageGetter {
		return (type: FSType, location?: string): Storage => {
			if (type === 'local') {
				return this.local.storage;
			} else if (type === 'synced') {
				return this.synced.storage;
			} else if (type === 'share') {
				// TODO implement returning shared storage
				throw new Error(`Providing shared storage is not implemented, yet`);
			} else {
				throw new Error(`Cannot provide ${type} storage via local storage`);
			}
		};
	}

	private storageGetterForSyncedStorage(): StorageGetter {
		return (type: FSType, location?: string): Storage => {
			if (type === 'synced') {
				return this.synced.storage;
			} else if (type === 'share') {
				// TODO implement returning shared storage
				throw new Error(`Providing shared storage is not implemented, yet`);
			} else {
				throw new Error(`Cannot provide ${type} storage via synced storage`);
			}
		};
	}

	async initExisting(user: string, getSigner: GetSigner,
			generateMasterKey: GenerateKey): Promise<boolean> {
		const key = await this.initFst(user, getSigner, generateMasterKey);
		const ok = (await this.synced.initExisting(key)) &&
			(await this.local.initExisting(key));
		return ok;
	}
	
	async initFromRemote(user: string, getSigner: GetSigner,
			generateMasterKey: GenerateKey): Promise<boolean> {
		const key = await this.initFst(user, getSigner, generateMasterKey);
		try {
			const ok = (await this.synced.initFromRemote(key)) &&
				(await this.local.initFromRemote(key));
			return ok;
		} catch (err) {
			this.synced = (undefined as any);
			this.local = (undefined as any);
			throw err;
		}
	}
	
	makeSyncedFSForApp(appFolder: string): Promise<WritableFS> {
		return this.synced.makeAppFS(appFolder);
	}

	makeLocalFSForApp(appFolder: string): Promise<WritableFS> {
		return this.local.makeAppFS(appFolder);
	}

	async getUserFS(type: StorageType): Promise<FSItem> {
		let fs: WritableFS;
		if (type === 'synced') {
			 fs = await this.synced.userFS();
		} else if (type === 'local') {
			fs = await this.local.userFS();
		} else if (type === 'device') {
			fs = await userFilesOnDevice();
		} else {
			throw new Error(`Unknown storage type ${type}`);
		}
		return {
			isFolder: true,
			item: fs
		};
	}

	async getSysFSs(type: StorageType): Promise<FSItem> {
		if (type === 'synced') {
			return {
				isCollection: true,
				item: await this.synced.sysFSs()
			};
		} else if (type === 'local') {
			return {
				isCollection: true,
				item: await this.local.sysFSs()
			};
		} else if (type === 'device') {
			return sysFilesOnDevice();
		} else {
			throw new Error(`Unknown storage type ${type}`);
		}
	}

	async close(): Promise<void> {
		if (!this.synced) { return; }
		const tasks: Promise<void>[] = [];
		tasks.push(this.synced.close());
		tasks.push(this.local.close());
		await Promise.all(tasks);
		this.synced = (undefined as any);
		this.local = (undefined as any);
	}

	/**
	 * This method mounts given file on device fs, returning respective device
	 * path. If file is on device fs, this method finds respective path.
	 * @param file 
	 */
	async mountOnDeviceFS(fs: FS, path: string): Promise<string> {
		let devPath = DeviceFS.getPath(path, fs);
		if (typeof devPath === 'string') { return devPath; }

		// XXX implement wrap and mount

		throw new Error('Mounting of storage items is not implemented, yet.');
	}
	
}
Object.freeze(Storages.prototype);
Object.freeze(Storages);

export async function userFilesOnDevice(): Promise<WritableFS> {
	if (process.platform.startsWith('win')) {
		return DeviceFS.makeWritable(process.env.USERPROFILE!);
	} else {
		return DeviceFS.makeWritable(process.env.HOME!);
	}
}


export async function sysFilesOnDevice(): Promise<FSItem> {
	const c = makeFSCollection();
	if (process.platform.startsWith('win')) {
		const sysDrive = process.env.SystemDrive!;
		await c.set!(sysDrive, {
			isFolder: true,
			item: await DeviceFS.makeWritable(sysDrive)
		});
	} else {
		await c.set!('', {
			isFolder: true,
			item: await DeviceFS.makeWritable('/')
		});
	}
	return { isCollection: true, item: c };
}

export interface FactoryOfAppFSs {
	makeSyncedFSForApp(appFolder: string): Promise<WritableFS>;
	makeLocalFSForApp(appFolder: string): Promise<WritableFS>;
	addPreCloseWait(wait: Promise<void>): void;
	getUserFS(type: StorageType): Promise<FSItem>;
	getSysFSs(type: StorageType): Promise<FSItem>;
}

type StorageService = web3n.storage.Service;

export class PerWinStorage {

	private appFSs = new Map<string, WritableFS>();

	constructor(
			private appFSsFactory: FactoryOfAppFSs,
			private policy: StoragePolicy) {
		Object.seal(this);
	}

	wrap(): { remoteCAP: StorageService; close: () => void; } {
		const remoteCAP: StorageService = {
			getAppLocalFS: bind(this, this.getAppLocalFS),
			getAppSyncedFS: bind(this, this.getAppSyncedFS)
		};
		if (this.policy.canOpenUserFS) {
			remoteCAP.getUserFS = bind(this, this.getUserFS);
		}
		if (this.policy.canOpenSysFS) {
			remoteCAP.getSysFS = bind(this, this.getSysFS);
		}
		Object.freeze(remoteCAP);
		return { remoteCAP, close: () => this.close() };
	}

	private async getAppSyncedFS(appName: string): Promise<WritableFS> {
		this.ensureAppFSAllowed(appName, 'synced');
		let appFS = this.appFSs.get(appName);
		if (!appFS) {
			appFS = await this.appFSsFactory.makeSyncedFSForApp(appName);
		}
		return appFS;
	}
	
	private async getAppLocalFS(appName: string): Promise<WritableFS> {
		this.ensureAppFSAllowed(appName, 'local');
		let appFS = this.appFSs.get(appName);
		if (!appFS) {
			appFS = await this.appFSsFactory.makeLocalFSForApp(appName);
		}
		return appFS;
	}

	/**
	 * This throws up, if given file system is not allowed to be opened.
	 * @param appFolder 
	 * @param type 
	 */
	private ensureAppFSAllowed(appFolder: string, type: 'local'|'synced'): void {
		if (typeof appFolder !== 'string') { throw makeBadAppNameExc(appFolder); }
		if (CORE_APPS_PREFIX ===
				appFolder.substring(0, CORE_APPS_PREFIX.length)) {
			throw makeNotAllowedToOpenAppFSExc(appFolder);
		}
		if (!this.policy.canOpenAppFS(appFolder, type)) {
			throw makeNotAllowedToOpenAppFSExc(appFolder); }
	}

	private async getUserFS(type: StorageType, path?: string):
			Promise<FSItem> {
		if (!this.policy.canOpenUserFS) {
			throw makeNotAllowedToOpenUserFSExc(type);
		}
		const policy = this.policy.canOpenUserFS(type);
		if (!policy) { throw makeNotAllowedToOpenUserFSExc(type); }

		const userFS = await this.appFSsFactory.getUserFS(type);
		return applyPolicyToFSItem(userFS, policy, path);
	}

	private async getSysFS(type: StorageType, path?: string): Promise<FSItem> {
		if (!this.policy.canOpenSysFS) {
			throw makeNotAllowedToOpenSysFSExc(type);
		}
		const policy = this.policy.canOpenSysFS(type);
		if (!policy) { throw makeNotAllowedToOpenSysFSExc(type); }

		const sysFS = await this.appFSsFactory.getSysFSs(type);
		return applyPolicyToFSItem(sysFS, policy, path);
	}
	
	private close(): void {
		for (const fs of this.appFSs.values()) {
			this.appFSsFactory.addPreCloseWait(fs.close());
		}
		this.appFSs.clear();
	}

}
Object.freeze(PerWinStorage.prototype);
Object.freeze(PerWinStorage);

async function applyPolicyToFSItem(fsi: FSItem,
		policy: 'w'|'r', path?: string): Promise<FSItem> {
	if (fsi.isFolder) {
		const item = await applyPolicyToFS(
			fsi.item as WritableFS, policy, path);
		return { isFolder: true, item };
	} else if (fsi.isCollection) {
		const item = await applyPolicyToFSCollection(
			fsi.item as FSCollection, policy, path);
		return { isCollection: true, item };
	} else {
		throw new Error(`Given fs item is neither folder, nor fs collection`);
	}
}

async function applyPolicyToFS(fs: WritableFS, policy: 'w'|'r', path?: string):
		Promise<FS> {
	if (policy === 'w') {
		return ((path === undefined) ? fs : fs.writableSubRoot(path));
	} else {
		if (path === undefined) {
			path = '/';
		}
		return fs.readonlySubRoot(path);
	}
}

async function applyPolicyToFSCollection(c: FSCollection, policy: 'w'|'r',
		path?: string): Promise<FSCollection|FS> {
	if (path === undefined) {
		if (policy === 'w') {
			return readonlyWrapFSCollection(c);
		} else {
			const roFSs = makeFSCollection();
			for (const v of (await c.getAll())) {
				const fs = (v[1].item as WritableFS);
				if (!v[1].isFolder || !fs || !fs.listFolder) { throw new Error(
					'Expected item to be a folder object'); }
				v[1].item = await (v[1].item! as FS).readonlySubRoot('/');
				await roFSs.set!(v[0], v[1]);
			}
			return readonlyWrapFSCollection(roFSs);
		}
	}

	if (path.startsWith('/')) {
		path = path.substring(1);
	}
	const nameAndItem = await asyncFind(await c.entries(),
		async v => path!.startsWith(v[0]));
	if (!nameAndItem) { throw makeFileException(excCode.notFound, path); }
	const [ name, item ] = nameAndItem;
	path = path.substring(name.length);

	const fs = (item.item as WritableFS);
	if (!item.isFolder || !fs || !fs.listFolder) { throw new Error(
		'Expected item to be a folder object'); }

	if (policy === 'w') {
		return ((path === undefined) ? fs : fs.writableSubRoot(path));
	} else {
		if (path === undefined) {
			path = '/';
		}
		return fs.readonlySubRoot(path);
	}
}

Object.freeze(exports);