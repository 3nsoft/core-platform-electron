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

import { IGetMailerIdSigner } from '../../lib-client/user-with-mid-session';
import { ObjSource }	from '../../lib-common/obj-streaming/common';
import { Storage, wrapStorageImplementation }
	from '../../lib-client/3nstorage/xsp-fs/common';
import { makeObjExistsExc } from '../../lib-client/3nstorage/exceptions';
import { StorageOwner as RemoteStorageOwner }
	from '../../lib-client/3nstorage/service';
import { ScryptGenParams } from '../../lib-client/key-derivation';
import { CacheFiles, makeCacheParts, DiffInfo, addDiffSectionTo }
	from './cache-files';
import { FS as DevFS, ListingEntry }
	from '../../lib-client/local-files/device-fs';
import { makeCachedObjSource } from './cached-obj-source';
import { FileException } from '../../lib-common/exceptions/file';
import { Uploader } from './uploader';
import { Downloader } from './downloader';
import { NamedProcs } from '../../lib-common/processes';

const CACHE_DIR = 'synced';
const KD_PARAMS_FILE_NAME = 'kd-params';

class StorageOwner implements Storage {
	
	private remoteStorage: RemoteStorageOwner;
	private files: CacheFiles = null;
	private uploader: Uploader = null;
	private downloader: Downloader = null;
	private objRWProcs = new NamedProcs();
	
	constructor(
			private devFS: DevFS,
			user: string, getSigner: IGetMailerIdSigner) {
		this.remoteStorage = new RemoteStorageOwner(user, getSigner);
		Object.seal(this);
	}
	
	/**
	 * @param remoteServiceUrl is a location of server for synch-ing.
	 * It can be null, in cases of postponed start of sync-ing, or complete
	 * offline work.
	 */
	async init(remoteServiceUrl: string): Promise<void> {
		let cacheFS = await this.devFS.makeSubRoot(CACHE_DIR);
		if (remoteServiceUrl) {
			await this.remoteStorage.setStorageUrl(remoteServiceUrl);
			await this.remoteStorage.login();
		}
		let cacheParts = await makeCacheParts(cacheFS, this.remoteStorage);
		this.files = cacheParts.files;
		this.uploader = cacheParts.up;
		this.downloader = cacheParts.down;
	}
	
	async getRootKeyDerivParams(): Promise<ScryptGenParams> {
		let params = await this.devFS.readJSONFile<ScryptGenParams>(
			KD_PARAMS_FILE_NAME).catch(
				(exc: FileException) => { if (!exc.notFound) { throw exc; } });
		if (!params) {
			// XXX keyDerivParams should be moved to a separate request, out of
			//		remote session setting
			params = this.remoteStorage.keyDerivParams;
			await this.devFS.writeJSONFile(KD_PARAMS_FILE_NAME, params);
		}
		return params;
	}
	
	async getObj(objId: string): Promise<ObjSource> {
		return this.objRWProcs.startOrChain(objId, async () => {
			let info = await this.files.findObj(objId);
			if (info) {
				if (info.isArchived) { throw new Error(
					`Object ${objId} has no current version.`); }
			} else {
				await this.downloader.startObjDownload(objId);
				info = await this.files.findObj(objId);
			}
			return makeCachedObjSource(this.files, this.downloader,
				objId, info.currentVersion);
		});
	}
	
	saveObj(objId: string, src: ObjSource): Promise<void> {
		return this.objRWProcs.startOrChain(objId, async () => {
			let version = src.getObjVersion();
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
				version: null
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
			this.remoteStorage = null;
		}
	}
	
}
Object.freeze(StorageOwner.prototype);
Object.freeze(StorageOwner);

export async function make3NStorageOwner(
		storeDevFS: DevFS, user: string, remoteServiceUrl: string,
		getMidSigner: IGetMailerIdSigner): Promise<Storage> {
	let s = new StorageOwner(storeDevFS, user, getMidSigner);
	await s.init(remoteServiceUrl);
	return wrapStorageImplementation(s);
}

Object.freeze(exports);