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

import { IGetMailerIdSigner } from '../../../lib-client/user-with-mid-session';
import { ObjSource }	from '../../../lib-common/obj-streaming/common';
import { SyncedStorage as ISyncedStorage, wrapSyncStorageImplementation,
	StorageType, NodesContainer, wrapStorageImplementation, Storage as IStorage,
	StorageGetter }
	from '../../../lib-client/3nstorage/xsp-fs/common';
import { makeObjExistsExc, makeObjNotFoundExc }
	from '../../../lib-client/3nstorage/exceptions';
import { StorageOwner as RemoteStorage }
	from '../../../lib-client/3nstorage/service';
import { ScryptGenParams } from '../../../lib-client/key-derivation';
import { CacheFiles, makeCacheParts, DiffInfo, addDiffSectionTo }
	from './cache-files';
import { FS as DevFS } from '../../../lib-client/local-files/device-fs';
import { makeCachedObjSource } from './cached-obj-source';
import { Uploader } from './uploader';
import { Downloader } from './downloader';
import { NamedProcs } from '../../../lib-common/processes';
import { bytes as randomBytes } from '../../../lib-client/random-node';
import { secret_box as sbox } from 'ecma-nacl';
import { base64urlSafe } from '../../../lib-common/buffer-utils';

class SyncedStorage implements ISyncedStorage {
	
	public type: StorageType = 'synced';
	public nodes = new NodesContainer();
	private remoteStorage: RemoteStorage;
	private files: CacheFiles = (undefined as any);
	private uploader: Uploader = (undefined as any);
	private downloader: Downloader = (undefined as any);
	private objRWProcs = new NamedProcs();
	
	constructor(
			private devFS: DevFS,
			user: string, getSigner: IGetMailerIdSigner,
			private getStorages: StorageGetter) {
		this.remoteStorage = new RemoteStorage(user, getSigner);
		Object.seal(this);
	}
	
	/**
	 * @param remoteServiceUrl is a location of server for synch-ing, or an async
	 * getter of such location.
	 */
	async init(remoteServiceUrl: string|(() => Promise<string>)): Promise<void> {
		// let cacheFS = await this.devFS.writableSubRoot(CACHE_DIR);
		await this.remoteStorage.setStorageUrl(remoteServiceUrl);
		let cacheParts = await makeCacheParts(this.devFS, this.remoteStorage);
		this.files = cacheParts.files;
		this.uploader = cacheParts.up;
		this.downloader = cacheParts.down;
	}

	storageForLinking(type: StorageType, location?: string): IStorage {
		if (type === 'synced') {
			return wrapStorageImplementation(this);
		} else if (type === 'share') {
			return this.getStorages('share', location);
		} else {
			throw new Error(`Getting ${type} storage is not implemented in local storage.`);
		}
	}
	
	getRootKeyDerivParamsFromServer(): Promise<ScryptGenParams> {
		return this.remoteStorage.getKeyDerivParams();
	}
	
	generateNewObjId(): string {
		let nonce = randomBytes(sbox.NONCE_LENGTH);
		let id = base64urlSafe.pack(nonce);
		if (this.nodes.reserveId(id)) {
			return id;
		} else {
			return this.generateNewObjId();
		}
	}

	async getObj(objId: string): Promise<ObjSource> {
		return this.objRWProcs.startOrChain(objId, async () => {
			let info = await this.files.findObj(objId);
			if (info) {
				if (info.isArchived) { throw makeObjNotFoundExc(objId); }
			} else {
				await this.downloader.startObjDownload(objId);
				info = await this.files.findObj(objId);
				if (!info) { throw new Error(`Expectation fail: info should be present, once download has started.`); }
			}
			if (typeof info.currentVersion !== 'number') { throw new Error(
				`Object ${objId} has no current version.`); }
			return makeCachedObjSource(this.files, this.downloader,
				objId, info.currentVersion);
		});
	}
	
	saveObj(objId: string, src: ObjSource): Promise<void> {
		return this.objRWProcs.startOrChain(objId, async () => {
			let version = src.getObjVersion()!;
			if ((version === 1) && (await this.files.findObj(objId))) {
				throw makeObjExistsExc(objId);
			}
			let actNum = await this.uploader.recordIntendedAction(objId, {
				completeUpload: true,
				version
			});
			await this.files.saveObj(objId, src);
			await this.uploader.activateSyncAction(objId, actNum);
		});
	}

	saveNewHeader(objId: string, ver: number, header: Uint8Array):
			Promise<void> {
		return this.objRWProcs.startOrChain(objId, async () => {
			let actNum = await this.uploader.recordIntendedAction(objId, {
				completeUpload: true,
				version: ver
			});

			// prepare diff and save file(s)
			let baseVersion = ver - 1;
			let segsSize = await this.files.getSegsSize(objId, baseVersion);
			let diff: DiffInfo = { baseVersion, segsSize, sections: [] };
			addDiffSectionTo(diff.sections, false, 0, segsSize);
			await this.files.saveDiff(objId, ver, diff, header);

			await this.uploader.activateSyncAction(objId, actNum);
		});
	}
	
	removeObj(objId: string): Promise<void> {
		return this.objRWProcs.startOrChain(objId, async () => {
			let actNum = await this.uploader.recordIntendedAction(objId, {
				deleteObj: true,
				version: undefined
			});
			await this.files.removeObj(objId);
			await this.uploader.activateSyncAction(objId, actNum);
		});
	}
	
	async close(): Promise<void> {
		try {
			// XXX add cleanups of unsynched with its possible ongoing transactions
			
			await this.remoteStorage.logout();
		} catch (err) {
			console.error(err);
		} finally {
			this.remoteStorage = (undefined as any);
		}
	}
	
}
Object.freeze(SyncedStorage.prototype);
Object.freeze(SyncedStorage);

export async function makeSyncedStorage(user: string,
		getMidSigner: IGetMailerIdSigner, storeDevFS: DevFS,
		remoteServiceUrl: string|(() => Promise<string>),
		getStorages: StorageGetter):
		Promise<ISyncedStorage> {
	let s = new SyncedStorage(storeDevFS, user, getMidSigner, getStorages);
	await s.init(remoteServiceUrl);
	return wrapSyncStorageImplementation(s);
}

Object.freeze(exports);