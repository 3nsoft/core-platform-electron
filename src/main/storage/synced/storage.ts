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

import { IGetMailerIdSigner } from '../../../lib-client/user-with-mid-session';
import { ObjSource }	from '../../../lib-common/obj-streaming/common';
import { SyncedStorage as ISyncedStorage, wrapSyncStorageImplementation,
	NodesContainer, wrapStorageImplementation, Storage as IStorage,
	StorageGetter }
	from '../../../lib-client/3nstorage/xsp-fs/common';
import { makeObjNotFoundExc }
	from '../../../lib-client/3nstorage/exceptions';
import { StorageOwner as RemoteStorage }
	from '../../../lib-client/3nstorage/service';
import { ScryptGenParams } from '../../../lib-client/key-derivation';
import { makeObjs, ObjId, ObjFiles } from './files/objs';
import { makeCachedObjSource } from './cached-obj-source';
import { makeLocalObjSource } from './local-obj-source';
import { ObjProcs } from './obj-procs/obj-proc';
import { SyncedVersionsDownloader } from './synced-versions-downloader';
import { bytesSync as randomBytes } from '../../../lib-common/random-node';
import { base64urlSafe } from '../../../lib-common/buffer-utils';
import { logError } from '../../../lib-client/logging/log-to-file';
import { makeStorageEventsProc, StorageEventsProc } from './storage-events';
import { AsyncSBoxCryptor, NONCE_LENGTH } from 'xsp-files';

type WritableFS = web3n.files.WritableFS;

class SyncedStorage implements ISyncedStorage {
	
	public type: web3n.files.FSType = 'synced';
	public versioned = true;
	public nodes = new NodesContainer();
	private remoteStorage: RemoteStorage = (undefined as any);
	private objFiles: ObjFiles = (undefined as any);
	private objProcs: ObjProcs = (undefined as any);
	private syncedVersionDownloader: SyncedVersionsDownloader = (undefined as any);
	private storageEventsProc: StorageEventsProc = (undefined as any);
	
	constructor(
		private getStorages: StorageGetter,
		public cryptor: AsyncSBoxCryptor
	) {
		Object.seal(this);
	}

	static async makeAndStart(devFS: WritableFS, user: string,
			getSigner: IGetMailerIdSigner, getStorages: StorageGetter,
			cryptor: AsyncSBoxCryptor, remoteServiceUrl: () => Promise<string>):
			Promise<SyncedStorage> {
		const s = new SyncedStorage(getStorages, cryptor);
		s.remoteStorage = new RemoteStorage(user, getSigner, remoteServiceUrl);
		s.objFiles = await makeObjs(devFS);
		const fsNodes = (objId: ObjId) => s.nodes.get(objId);
		s.objProcs = new ObjProcs(s.remoteStorage, s.objFiles, fsNodes);
		s.syncedVersionDownloader = new SyncedVersionsDownloader(
			s.objFiles.synced, s.remoteStorage);
		s.storageEventsProc = makeStorageEventsProc(s.remoteStorage,
			(objId: ObjId) => s.objProcs.getOpened(objId),
			fsNodes, s.objFiles.synced);
		return s;
	}

	storageForLinking(type: web3n.files.FSType, location?: string): IStorage {
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
		const nonce = randomBytes(NONCE_LENGTH);
		const id = base64urlSafe.pack(nonce);
		if (this.nodes.reserveId(id)) {
			return id;
		} else {
			return this.generateNewObjId();
		}
	}

	getSyncedObjVersion(objId: ObjId, version: number): Promise<ObjSource> {
		return makeCachedObjSource(this.objFiles.synced.reader,
			this.syncedVersionDownloader, objId, version);
	}

	async getObj(objId: ObjId): Promise<ObjSource> {
		let info = await this.objFiles.findObj(objId);
		if (info && info.isArchived) {
			throw makeObjNotFoundExc(objId!);
		} else if (!info || !info.current) {
			await this.syncedVersionDownloader.startObjDownload(objId);
			info = await this.objFiles.findObj(objId);
			if (!info || !info.current) {
				throw new Error(`Expectation fail: info should be present, once download has started for a current version.`); }
		} else if (info.current.isLocal) {
			return makeLocalObjSource(this.objFiles,
				this.objProcs.getOrMakeObjProc(objId).syncCompletion$,
				objId, info.current.version);
		}
		return this.getSyncedObjVersion(objId, info.current.version);
	}
	
	saveObj(objId: ObjId, src: ObjSource): Promise<void> {
		const p = this.objProcs.getOrMakeObjProc(objId);
		return p.change.saveObj(src);
	}

	async removeObj(objId: string): Promise<void> {
		const p = this.objProcs.getOrMakeObjProc(objId);
		await p.change.removeObj();
		this.objProcs.delete(objId);
	}

	startSyncOfFilesInCache(): void {
		this.objProcs.startSyncOfFilesInCache();
	}

	setCurrentSyncedVersion(objId: string, syncedVer: number): Promise<void> {
		return this.objFiles.local.setCurrentSyncedVersion(objId, syncedVer);
	}

	async close(): Promise<void> {
		try {
			this.storageEventsProc.close();
			await this.objProcs.close();
			await this.remoteStorage.logout();
		} catch (err) {
			await logError(err);
		} finally {
			this.remoteStorage = (undefined as any);
		}
	}

}
Object.freeze(SyncedStorage.prototype);
Object.freeze(SyncedStorage);

export async function makeSyncedStorage(user: string,
		getMidSigner: IGetMailerIdSigner, storeDevFS: WritableFS,
		remoteServiceUrl: () => Promise<string>,
		getStorages: StorageGetter, cryptor: AsyncSBoxCryptor):
		Promise<{ syncedStore: ISyncedStorage; startSyncOfFiles: () => void; }> {
	const s = await SyncedStorage.makeAndStart(
		storeDevFS, user, getMidSigner, getStorages, cryptor, remoteServiceUrl);
	return {
		syncedStore: wrapSyncStorageImplementation(s),
		startSyncOfFiles: () => s.startSyncOfFilesInCache()
	};
}

Object.freeze(exports);