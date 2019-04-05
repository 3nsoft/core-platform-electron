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
	storageSegment: 'app'|'system'|'user'|'device';
	appName?: string;
	badAppName?: boolean;
	notAllowedToOpenFS?: boolean;
	storageType?: StorageType;
	notAllowedToOpenDevPath?: boolean;
	pathOnDevice?: string;
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

function makeNotAllowedToOpenDevPathExc(path: string): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'device',
		notAllowedToOpenDevPath: true,
		pathOnDevice: path
	};
}

const CORE_APPS_PREFIX = 'computer.3nweb.core';
export const STORAGE_APP = 'computer.3nweb.storage';

const KD_PARAMS_FILE_NAME = 'kd-params';
const LOCAL_STORAGE_DIR = 'local';
const SYNCED_STORAGE_DIR = 'synced';

/**
 * This function tries to get key derivation parameters from cache on a disk.
 * If not found, function will return undefined.
 * @param fs 
 */
function readRootKeyDerivParamsFromCache(fs: WritableFS):
		Promise<ScryptGenParams|undefined> {
	return fs.readJSONFile<ScryptGenParams>(KD_PARAMS_FILE_NAME).catch(
		(exc: FileException) => {
			if (exc.notFound) { return undefined; }
			throw exc;
	});
}

/**
 * This function tries to get key derivation parameters from cache on a disk.
 * If not found, it will ask storage server for it with a provided function.
 * @param fs 
 * @param getFromServer 
 */
async function getRootKeyDerivParams(fs: WritableFS,
		getFromServer: () => Promise<ScryptGenParams>): Promise<ScryptGenParams> {
	let params = await readRootKeyDerivParamsFromCache(fs);
	if (!params) {
		params = await getFromServer();
		await fs.writeJSONFile(KD_PARAMS_FILE_NAME, params);
	}
	return params;
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
	
	private constructor(
			public storage: T) {
		Object.seal(this);
	}

	static async existing<T extends Storage>(storage: T, key: Uint8Array):
			Promise<StorageAndFS<T>|undefined> {
		const s = new StorageAndFS(storage);
		try {
			s.rootFS = await xspFS.fromExistingRoot(s.storage, key);
			return s;
		} catch (err) {
			if ((err as EncryptionException).failedCipherVerification) {
				return;
			} else {
				throw err;
			}
		}
	}

	static async newOrExisting<T extends Storage>(storage: T, key: Uint8Array):
			Promise<StorageAndFS<T>|undefined> {
		const s = new StorageAndFS(storage);
		try {
			s.rootFS = await xspFS.fromExistingRoot(s.storage, key);
			return s;
		} catch (err) {
			if ((err as StorageException).objNotFound) {
				s.rootFS = await xspFS.makeNewRoot(s.storage, key);
				await initSysFolders(s.rootFS);
				return s;
			} else if ((err as EncryptionException).failedCipherVerification) {
				return;
			} else {
				throw err;
			}
		}
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

export class Storages implements FactoryOfAppFSs {

	private synced: StorageAndFS<SyncedStorage>|undefined = undefined;
	
	private local: StorageAndFS<Storage>|undefined = undefined;

	private preCloseWaits = new Set<Promise<void>>();

	constructor(
			private cryptor: AsyncSBoxCryptor
		) {
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
	 * This is a storage getter for links and linking in local storage.
	 */
	private storageGetterForLocalStorage: StorageGetter = (type) => {
		if (type === 'local') {
			return this.local!.storage;	// TypeError can be due to no init
		} else if (type === 'synced') {
			return this.synced!.storage;	// TypeError can be due to no init
		} else if (type === 'share') {
			// TODO implement returning shared storage
			throw new Error(`Providing shared storage is not implemented, yet`);
		} else {
			throw new Error(`Cannot provide ${type} storage via local storage`);
		}
	};

	/**
	 * This is a storage getter for links and linking in synced storage.
	 */
	private storageGetterForSyncedStorage: StorageGetter = (type) => {
		if (type === 'synced') {
			return this.synced!.storage;	// TypeError can be due to no init
		} else if (type === 'share') {
			// TODO implement returning shared storage
			throw new Error(`Providing shared storage is not implemented, yet`);
		} else {
			throw new Error(`Cannot provide ${type} storage via synced storage`);
		}
	};

	async startInitFromCache(user: string, keyGen: GenerateKey):
			Promise<((getSigner: GetSigner) => Promise<boolean>)|undefined> {
		const storageFS = await makeStorageFS(user);
		const params = await readRootKeyDerivParamsFromCache(storageFS);
		if (!params) { return; }
		const key = await keyGen(params);
		this.local = await StorageAndFS.existing(await makeLocalStorage(
			await storageFS.writableSubRoot(LOCAL_STORAGE_DIR),
			this.storageGetterForLocalStorage,
			this.cryptor), key);
		if (!this.local) { return; }
		return async (getSigner) => {
			if (this.synced) { return true; }
			const { startSyncOfFiles, syncedStore } = await makeSyncedStorage(
				user, getSigner,
				await storageFS.writableSubRoot(SYNCED_STORAGE_DIR),
				() => getStorageServiceFor(user),
				this.storageGetterForSyncedStorage,
				this.cryptor);
			this.synced = await StorageAndFS.existing(syncedStore, key);
			key.fill(0);
			if (!this.synced) { return false; }
			await startSyncOfFiles();
			return true;
		};
	}

	async initFromRemote(user: string, getSigner: GetSigner,
			keyOrGen: GenerateKey|Uint8Array): Promise<boolean> {
		const storageFS = await makeStorageFS(user);
		const { startSyncOfFiles, syncedStore } = await makeSyncedStorage(
			user, getSigner,
			await storageFS.writableSubRoot(SYNCED_STORAGE_DIR),
			() => getStorageServiceFor(user),
			this.storageGetterForSyncedStorage,
			this.cryptor);
		// getting parameters records them locally on a disk
		const params = await getRootKeyDerivParams(
			storageFS, syncedStore.getRootKeyDerivParamsFromServer);
		const key = ((typeof keyOrGen === 'function') ?
			await keyOrGen(params) : keyOrGen);
		this.synced = await StorageAndFS.newOrExisting(syncedStore, key);
		this.local = await StorageAndFS.newOrExisting(await makeLocalStorage(
			await storageFS.writableSubRoot(LOCAL_STORAGE_DIR),
			this.storageGetterForLocalStorage,
			this.cryptor), key);
		key.fill(0);
		startSyncOfFiles();

		return (!!this.synced && !!this.local);
	}

	makeSyncedFSForApp(appFolder: string): Promise<WritableFS> {
		// TypeError for undefined synced can be due to no init
		return this.synced!.makeAppFS(appFolder);
	}

	makeLocalFSForApp(appFolder: string): Promise<WritableFS> {
		// TypeError for undefined local can be due to no init
		return this.local!.makeAppFS(appFolder);
	}

	async getUserFS(type: StorageType): Promise<FSItem> {
		let fs: WritableFS;
		if (type === 'synced') {
			// TypeError for undefined synced can be due to no init
			 fs = await this.synced!.userFS();
		} else if (type === 'local') {
			// TypeError for undefined local can be due to no init
			fs = await this.local!.userFS();
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
				// TypeError for undefined synced can be due to no init
				item: await this.synced!.sysFSs()
			};
		} else if (type === 'local') {
			return {
				isCollection: true,
				// TypeError for undefined local can be due to no init
				item: await this.local!.sysFSs()
			};
		} else if (type === 'device') {
			return sysFilesOnDevice();
		} else {
			throw new Error(`Unknown storage type ${type}`);
		}
	}

	async close(): Promise<void> {
		if (!this.local) { return; }
		if (this.synced) {
			await this.synced.close();
		}
		await this.local.close();
		this.synced = undefined;
		this.local = undefined;
	}

	/**
	 * This method mounts given file on device fs, returning respective device
	 * path. If file is on device fs, this method finds respective path.
	 * @param fs
	 * @param path
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
		return DeviceFS.makeWritableFS(process.env.USERPROFILE!);
	} else {
		return DeviceFS.makeWritableFS(process.env.HOME!);
	}
}


export async function sysFilesOnDevice(): Promise<FSItem> {
	const c = makeFSCollection();
	if (process.platform.startsWith('win')) {
		const sysDrive = process.env.SystemDrive!;
		await c.set!(sysDrive, {
			isFolder: true,
			item: await DeviceFS.makeWritableFS(sysDrive)
		});
	} else {
		await c.set!('', {
			isFolder: true,
			item: await DeviceFS.makeWritableFS('/')
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
		if (this.policy.canAccessDevicePath) {
			remoteCAP.getOnDevice = bind(this, this.getOnDevice);
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
		const canOpen = this.policy.canOpenUserFS(type);
		if (!canOpen) { throw makeNotAllowedToOpenUserFSExc(type); }

		const userFS = await this.appFSsFactory.getUserFS(type);
		return applyPolicyToFSItem(userFS, canOpen, path);
	}

	private async getSysFS(type: StorageType, path?: string): Promise<FSItem> {
		if (!this.policy.canOpenSysFS) {
			throw makeNotAllowedToOpenSysFSExc(type);
		}
		const canOpen = this.policy.canOpenSysFS(type);
		if (!canOpen) { throw makeNotAllowedToOpenSysFSExc(type); }

		const sysFS = await this.appFSsFactory.getSysFSs(type);
		return applyPolicyToFSItem(sysFS, canOpen, path);
	}

	private async getOnDevice(path: string, ro = false): Promise<FSItem> {
		if (!this.policy.canAccessDevicePath) {
			throw makeNotAllowedToOpenDevPathExc(path);
		}
		const canOpen = this.policy.canAccessDevicePath(path);
		if (!canOpen) { throw makeNotAllowedToOpenDevPathExc(path); }

		const writable = (ro ? false : (canOpen === 'w'));
		return DeviceFS.makeFSItemFor(path, writable);
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