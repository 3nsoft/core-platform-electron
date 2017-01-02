/*
 Copyright (C) 2015 - 2016 3NSoft Inc.
 
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

import { Duplex, RequestEnvelope }	from '../../lib-common/ipc/electron-ipc';
import { IGetSigner, IGenerateCrypt, MasterCryptors, storage }
	from '../../renderer/common';
import { FS as DevFS } from '../../lib-client/local-files/device-fs';
import { FS, SyncedStorage, Storage, sysFolders, StorageGetter, StorageType }
	from '../../lib-client/3nstorage/xsp-fs/common';
import { FS as xspFS } from '../../lib-client/3nstorage/xsp-fs/fs';
import { StorageException as BaseExc, StorageExceptionType }
	from '../../lib-client/3nstorage/exceptions';
import { makeStorageFS } from '../../lib-client/local-files/app-files';
import { makeSyncedStorage } from './synced/storage';
import { makeLocalStorage } from './local/storage';
import { getStorageServiceFor } from '../../lib-client/service-locator';
import { bind } from '../../lib-common/binding';
import { makeRuntimeException } from '../../lib-common/exceptions/runtime';
import { AllProxies, ProxiedObjGetter } from '../proxied-objs/fs';
import { ScryptGenParams } from '../../lib-client/key-derivation';
import { FileException } from '../../lib-common/exceptions/file';
import { secret_box as sbox } from 'ecma-nacl';

type EncryptionException = web3n.EncryptionException;

export interface StorageException extends BaseExc {
	appName?: string;
	badAppName?: boolean;
	notAllowedToOpenFS?: boolean;
}

function makeBadAppNameExc(appName: string): StorageException {
	let exc = <StorageException> makeRuntimeException(
		'badAppName', StorageExceptionType);
	exc.appName = appName;
	return exc;
}

function makeNotAllowedToOpenFSExc(appName: string): StorageException {
	let exc = <StorageException> makeRuntimeException(
		'notAllowedToOpenFS', StorageExceptionType);
	exc.appName = appName;
	return exc;
}

let CORE_APPS_PREFIX = 'computer.3nweb.core';

const KD_PARAMS_FILE_NAME = 'kd-params';
const LOCAL_STORAGE_DIR = 'local';
const SYNCED_STORAGE_DIR = 'synced';

async function getRootKeyDerivParams(fs: DevFS,
		getFromServer: () => Promise<ScryptGenParams>): Promise<ScryptGenParams> {
	return fs.readJSONFile<ScryptGenParams>(KD_PARAMS_FILE_NAME).catch(
		async (exc: FileException) => {
			if (!exc.notFound) { throw exc; }
			let params = await getFromServer();
			await fs.writeJSONFile(KD_PARAMS_FILE_NAME, params);
			return params;
	});
}

class StorageAndFS<T extends Storage> {
	
	rootFS: FS = (undefined as any);
	
	constructor(
			public storage: T) {
		Object.seal(this);
	}

	async initExisting(decr: sbox.Decryptor): Promise<boolean> {
		try {
			this.rootFS = await xspFS.makeExisting(this.storage, null!, decr);
			return true;
		} catch (err) {
			if ((err as EncryptionException).failedCipherVerification) {
				return false;
			} else {
				throw err;
			}
		}
	}

	async initFromRemote(master: MasterCryptors): Promise<boolean> {
		try {
			this.rootFS = await xspFS.makeExisting(this.storage, null!, master.decr);
		} catch (err) {
			if ((err as StorageException).objNotFound) {
				this.rootFS = await xspFS.makeNewRoot(this.storage, master.encr);
			} else if ((err as EncryptionException).failedCipherVerification) {
				return false;
			} else {
				throw err;
			}
		}
		return true;
	}
	
	makeAppFS(appFolder: string): Promise<FS> {
		if (('string' !== typeof appFolder) ||
				(appFolder.length === 0) ||
				(appFolder.indexOf('/') >= 0)) {
			throw makeBadAppNameExc(appFolder);
		}
		if (!this.rootFS) { throw new Error('Storage is not initialized.'); }
		return this.rootFS.writableSubRoot(`${sysFolders.appData}/${appFolder}`);
	}

	async close(): Promise<void> {
		if (!this.rootFS) { return; }
		await this.rootFS.close();
		await this.storage.close();
		this.rootFS = (undefined as any);
		this.storage = (undefined as any);
	}
}

export class Storages {
	
	private synced: StorageAndFS<SyncedStorage> = (undefined as any);
	
	private local: StorageAndFS<Storage> = (undefined as any);

	private perWinStorages = new Set<PerWinStorage>();
	
	constructor() {
		Object.seal(this);
	}

	private storageGetterForLocalStorage(): StorageGetter {
		return (type: StorageType, location?: string): Storage => {
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
		return (type: StorageType, location?: string): Storage => {
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

	storageGetterForASMail(): StorageGetter {
		return (type: StorageType, location?: string): Storage => {
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
	 * @param generateMasterCrypt
	 */
	private async initFst(user: string, getSigner: IGetSigner,
			generateMasterCrypt: IGenerateCrypt): Promise<MasterCryptors> {
		let storageFS = await makeStorageFS(user);
		if (!this.synced) {
			this.synced = new StorageAndFS(await makeSyncedStorage(
				user, getSigner,
				await storageFS.writableSubRoot(SYNCED_STORAGE_DIR),
				() => getStorageServiceFor(user),
				this.storageGetterForSyncedStorage()));
		}
		if (!this.local) {
			this.local = new StorageAndFS(await makeLocalStorage(
				await storageFS.writableSubRoot(LOCAL_STORAGE_DIR),
				this.storageGetterForLocalStorage()));
		}
		let params = await getRootKeyDerivParams(storageFS,
			this.synced.storage.getRootKeyDerivParamsFromServer);
		return await generateMasterCrypt(params);
	}

	async initExisting(user: string, getSigner: IGetSigner,
			generateMasterCrypt: IGenerateCrypt):
			Promise<boolean> {
		let master = await this.initFst(user, getSigner,generateMasterCrypt);
		try {
			let ok = (await this.synced.initExisting(master.decr)) &&
				(await this.local.initExisting(master.decr));
			return ok;
		} finally {
			master.decr.destroy();
			master.encr.destroy();
		}
	}
	
	async initFromRemote(user: string, getSigner: IGetSigner,
			generateMasterCrypt: IGenerateCrypt): Promise<boolean> {
		let master = await this.initFst(user, getSigner,generateMasterCrypt);
		try {
			let ok = (await this.synced.initFromRemote(master)) &&
				(await this.local.initFromRemote(master));
			return ok;
		} catch (err) {
			this.synced = (undefined as any);
			this.local = (undefined as any);
			throw err;
		} finally {
			master.decr.destroy();
			master.encr.destroy();
		}
	}
	
	attachTo(rendererSide: Duplex, policy: StoragePolicy): ProxiedObjGetter {
		let winStorage = new PerWinStorage(this, rendererSide, policy);
		this.perWinStorages.add(winStorage);
		return winStorage.proxiedObjsGetter();
	}
	
	makeSyncedFSForApp(appFolder: string): Promise<FS> {
		return this.synced.makeAppFS(appFolder);
	}

	makeLocalFSForApp(appFolder: string): Promise<FS> {
		return this.local.makeAppFS(appFolder);
	}

	async close(): Promise<void> {
		if (!this.synced) { return; }
		let tasks: Promise<void>[] = [];
		for (let s of this.perWinStorages) {
			tasks.push(s.close());
		}
		tasks.push(this.synced.close());
		tasks.push(this.local.close());
		await Promise.all(tasks);
		this.synced = (undefined as any);
		this.local = (undefined as any);
	}
	
}
Object.freeze(Storages.prototype);
Object.freeze(Storages);

export interface StoragePolicy {
	canOpenAppFS(appName: string): boolean;
}

export class PerWinStorage {

	private proxies: AllProxies;
	
	constructor(
			private store: Storages,
			private rendererSide: Duplex,
			private policy: StoragePolicy) {
		this.proxies = new AllProxies(rendererSide);
		this.attachHandlersToUI();
		Object.freeze(this);
	}

	proxiedObjsGetter(): ProxiedObjGetter {
		return this.proxies.objGetter;
	}
	
	private attachHandlersToUI(): void {
		let reqNames = storage.reqNames;
		this.rendererSide.addHandler(reqNames.openAppSyncedFS,
			bind(this, this.handleOpenAppSyncedFS));
		this.rendererSide.addHandler(reqNames.openAppLocalFS,
			bind(this, this.handleOpenAppLocalFS));
	}
	
	private async handleOpenAppSyncedFS(env: RequestEnvelope<string>):
			Promise<string> {
		let appFolder = env.req;
		if (typeof appFolder !== 'string') { throw makeBadAppNameExc(appFolder); }
		if (CORE_APPS_PREFIX ===
				appFolder.substring(0, CORE_APPS_PREFIX.length)) {
			throw makeNotAllowedToOpenFSExc(appFolder);
		}
		if (!this.policy.canOpenAppFS(appFolder)) {
			throw makeNotAllowedToOpenFSExc(appFolder); }
		let appFS = await this.store.makeSyncedFSForApp(appFolder);
		let fsId = this.proxies.fss.add(appFS);
		return fsId;
	}
	
	private async handleOpenAppLocalFS(env: RequestEnvelope<string>):
			Promise<string> {
		let appFolder = env.req;
		if (typeof appFolder !== 'string') { throw makeBadAppNameExc(appFolder); }
		if (CORE_APPS_PREFIX ===
				appFolder.substring(0, CORE_APPS_PREFIX.length)) {
			throw makeNotAllowedToOpenFSExc(appFolder);
		}
		if (!this.policy.canOpenAppFS(appFolder)) {
			throw makeNotAllowedToOpenFSExc(appFolder); }
		let appFS = await this.store.makeLocalFSForApp(appFolder);
		let fsId = this.proxies.fss.add(appFS);
		return fsId;
	}
	
	async close(): Promise<void> {
		await this.proxies.fss.close();
	}

}
Object.freeze(PerWinStorage.prototype);
Object.freeze(PerWinStorage);

Object.freeze(exports);