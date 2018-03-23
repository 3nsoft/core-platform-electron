/*
 Copyright (C) 2016 - 2017 3NSoft Inc.

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

import { writeObjTo, parseObjFileOffsets }
	from '../../../../lib-client/obj-file-on-dev-fs';
import { ObjId, Objs, notFoundOrReThrow } from './objs';
import { DiffInfo } from '../../../../lib-common/service-api/3nstorage/owner';
import { FileException } from '../../../../lib-common/exceptions/file';
import { ObjReader, ObjFileReader } from './obj-reader';
import { logWarning } from '../../../../lib-client/logging/log-to-file';

/**
 * This is an extention for a local version file. File name starts with a
 * version number.
 */
export const LOCAL_FILE_NAME_EXT = 'local';

/**
 * This is an extention for an upload info file. File name starts with a
 * version that is being uploaded. When upload of a version is complete,
 * this info file is removed.
 */
export const UPLOAD_INFO_FILE_EXT = 'upload';

/**
 * Presence of this empty file in a object folder indicates that object's
 * removal hasn't been synchronized, yet.
 */
export const UNSYNCED_REMOVAL = 'unsynced-removal';

export interface LocalObjVersions {

	startSaving(objId: ObjId, version: number, diff: DiffInfo|undefined,
		header: Uint8Array, segs?: Uint8Array, last?: boolean): Promise<void>;
	
	continueSaving(objId: ObjId, version: number, segs: Uint8Array|undefined,
		last?: boolean): Promise<void>;

	reader: ObjReader;

	changeVersionToSynced(objId: ObjId, localVersion: number): Promise<void>;

	getIncompleteSync(objId: ObjId): Promise<IncompleteSync|undefined>;

	getUploadInfo(objId: ObjId, version: number): Promise<UploadInfo|undefined>;

	saveUploadInfo(objId: ObjId, version: number, info: UploadInfo):
		Promise<void>;

	clearUploadInfo(objId: ObjId, version: number): Promise<void>;

	/**
	 * This function removes current object's version, and sets unsynced removal
	 * file in object's folder.
	 * @param objId
	 */
	removeCurrentObjVersion(objId: ObjId): Promise<void>;

	/**
	 * This function unsynced removal file, and triggers gc of given object's
	 * folder.
	 * @param objId
	 */
	setRemovalAsSynced(objId: ObjId): Promise<void>;

	indicateConflict(objId: ObjId, remoteVersion: number): Promise<void>;

	/**
	 * This sets given object version as current and syncronized.
	 */
	setCurrentSyncedVersion(objId: string, syncedVersion: number): Promise<void>;

}

export interface UploadInfo {
	transactionId?: string;
	segsUploaded: number;
	done: boolean;
}

export interface IncompleteSync {
	removal?: boolean;
	unsynced?: {
		lastSyncedVersion?: number;
		localVersions: number[];
		conflictingRemoteVersion?: number;
	};
}

export class LocalVersions implements LocalObjVersions {

	reader: ObjFileReader;
	
	constructor(
			private objs: Objs) {
		this.reader = new ObjFileReader(this.objs, LOCAL_FILE_NAME_EXT);
		Object.freeze(this);
	}

	async startSaving(objId: ObjId, version: number,
			diff: DiffInfo|undefined, header: Uint8Array, segs?: Uint8Array,
			last?: boolean): Promise<void> {
		const objFolder = await this.objs.getOrMakeObjFolder(objId);
		const diffBytes = (diff ?
			new Buffer(JSON.stringify(diff), 'utf8') : undefined);
		const fPath = `${objFolder}/${version}.${LOCAL_FILE_NAME_EXT}`;
		const sink = await this.objs.fs.getByteSink(fPath, true, true)
		.catch(async (exc: FileException) => {
			if (!exc.alreadyExists) { throw exc; }
			await this.objs.fs.deleteFile(fPath);
			return this.objs.fs.getByteSink(fPath, true, true);
		});
		await writeObjTo(sink, diffBytes, header, segs, true);
		if (last) {
			await this.objs.setCurrentLocalVersion(objFolder, objId, version);
		}
	}

	async continueSaving(objId: ObjId, version: number,
			segs: Uint8Array|undefined, last?: boolean): Promise<void> {
		const objFolder = (await this.objs.getObjFolder(objId))!;
		const fPath = `${objFolder}/${version}.${LOCAL_FILE_NAME_EXT}`;
		if (segs) {
			const sink = await this.objs.fs.getByteSink(fPath, false);
			const fileLen = await sink.getSize();
			await sink.seek!(fileLen!);
			await sink.write(segs);
			await sink.write(null);
		}
		if (last) {
			await this.objs.setCurrentLocalVersion(objFolder, objId, version);
		}
	}

	async changeVersionToSynced(objId: ObjId, version: number): Promise<void> {
		const objFolder = (await this.objs.getObjFolder(objId))!;
		const localFile = `${objFolder}/${version}.${LOCAL_FILE_NAME_EXT}`;
		const syncedFile = `${objFolder}/${version}.`;
		await this.objs.fs.move(localFile, syncedFile);
		const status = await this.objs.getObjStatus(objId, objFolder);
		if (!status.current) { throw new Error(
			`Invalid state: no current version in status for object ${objId}`); }
		if (status.current.isLocal && (status.current.version === version)) {
			status.current.isLocal = false;
			status.syncState = 'synced';
			status.latestSynced = version;
			await this.objs.setObjStatus(status, objFolder);
		} else if (!status.latestSynced || (status.latestSynced < version)) {
			status.latestSynced = version;
			await this.objs.setObjStatus(status, objFolder);
		}
		this.objs.gc.scheduleCollection(objId);
	}

	async getIncompleteSync(objId: ObjId): Promise<IncompleteSync|undefined> {
		const objFolder = (await this.objs.getObjFolder(objId, false));
		if (!objFolder) { return; }
		const status = await this.objs.getObjStatus(objId, objFolder)
		.catch(notFoundOrReThrow);
		if (!status || (status.syncState === 'synced')) { return; }
		if ((status.syncState !== 'unsynced')
		&& (status.syncState !== 'conflicting')) {
			await logWarning(`Synced storage object ${objId} had unknown value ${status.syncState} set as sync state in status.`);
			status.syncState = 'unsynced';
			await this.objs.setObjStatus(status);
			return this.getIncompleteSync(objId);
		}
		if (status.current) {
			
			const lst = await this.objs.fs.listFolder(objFolder);
			const localVersions: number[] = [];
			for (const f of lst) {
				if (!f.isFile) { continue; }
				if (!f.name.endsWith(LOCAL_FILE_NAME_EXT)) { continue; }
				const v = parseInt(f.name);
				if (isNaN(v) || (v > status.current.version)) { continue; }
				if ((status.latestSynced === undefined)
				|| (v > status.latestSynced)) {
					localVersions.push(v);
				}
			}

			if (localVersions.length === 0) {
				status.syncState = 'synced';
				await this.objs.setObjStatus(status);
				await logWarning(`Synced storage object ${objId} had non synced state set in status, while it has no unsynced local versions.`);
				return;
			}

			const conflictingRemoteVersion = ((status.syncState === 'conflicting')?
				status.conflictingRemVer! : undefined);
			return {
				unsynced: {
					lastSyncedVersion: status.latestSynced,
					localVersions,
					conflictingRemoteVersion
				}
			};
		} else if (status.isArchived) {
			const unsycedRemovalPresent = await this.objs.fs.checkFilePresence(
				`${objFolder}/${UNSYNCED_REMOVAL}`);
			if (unsycedRemovalPresent) {
				return { removal: true };
			}
		}
	}

	async getUploadInfo(objId: ObjId, version: number):
			Promise<UploadInfo|undefined> {
		const objFolder = await this.objs.getObjFolder(objId, false);
		if (objFolder) { return; }
		const infoFile = `${objFolder}/${version}.${UPLOAD_INFO_FILE_EXT}`;
		return this.objs.fs.readJSONFile<UploadInfo>(infoFile)
		.catch(notFoundOrReThrow);
	}

	async saveUploadInfo(objId: ObjId, version: number, info: UploadInfo):
			Promise<void> {
		const objFolder = (await this.objs.getObjFolder(objId))!;
		const infoFile = `${objFolder}/${version}.${UPLOAD_INFO_FILE_EXT}`;
		await this.objs.fs.writeJSONFile(infoFile, info);
	}

	async clearUploadInfo(objId: ObjId, version: number): Promise<void> {
		const objFolder = (await this.objs.getObjFolder(objId))!;
		const infoFile = `${objFolder}/${version}.${UPLOAD_INFO_FILE_EXT}`;
		await this.objs.fs.deleteFile(infoFile)
		.catch(noop);
	}

	async removeCurrentObjVersion(objId: ObjId): Promise<void> {
		await this.objs.removeCurrentObjVersion(objId, false);
		const objFolder = (await this.objs.getObjFolder(objId))!;
		const labelFile = `${objFolder}/${UNSYNCED_REMOVAL}`;
		await this.objs.fs.writeTxtFile(labelFile, '');
	}

	async setRemovalAsSynced(objId: ObjId): Promise<void> {
		const objFolder = (await this.objs.getObjFolder(objId))!;
		const labelFile = `${objFolder}/${UNSYNCED_REMOVAL}`;
		await this.objs.fs.deleteFile(labelFile);
		this.objs.gc.scheduleCollection(objId);
	}

	async indicateConflict(objId: ObjId, remoteVersion: number): Promise<void> {
		const objFolder = (await this.objs.getObjFolder(objId))!;
		const status = await this.objs.getObjStatus(objId, objFolder);
		status.conflictingRemVer = remoteVersion;
		status.syncState = 'conflicting';
		await this.objs.setObjStatus(status);
	}

	async setCurrentSyncedVersion(objId: string, syncedVersion: number):
			Promise<void> {
		const objFolder = (await this.objs.getObjFolder(objId))!;
		const status = await this.objs.getObjStatus(objId, objFolder);
		if (!status.current) { throw new Error(
			`Missing current version in a status of object ${objId}`); }
		status.current.version = syncedVersion;
		status.current.isLocal = false;
		status.latestSynced = status.current.version;
		status.syncState = 'synced';
		await this.objs.setObjStatus(status, objFolder);
		this.objs.gc.scheduleCollection(objId);
	}

	private async reencryptHeaderInObjFile(path: string,
			reencryptHeader: ReencryptHeader, newVer: number): Promise<void> {
		const { headerOffset, segsOffset } = await parseObjFileOffsets(
			this.objs.fs, path);
		const initHeader = (await this.objs.fs.readBytes(
			path, headerOffset, segsOffset))!;
		const newHeader = await reencryptHeader(initHeader, newVer);
		const sink = await this.objs.fs.getByteSink(path);
		await sink.seek!(headerOffset);
		await sink.write(newHeader);
		await sink.write(null);
	}

	wrap(): LocalObjVersions {
		const w: LocalObjVersions = {
			continueSaving: this.objs.syncAndBind(this, this.continueSaving),
			startSaving: this.objs.syncAndBind(this, this.startSaving),
			reader: this.reader.wrap(),
			changeVersionToSynced: this.objs.syncAndBind(this,
				this.changeVersionToSynced),
			getIncompleteSync: this.objs.syncAndBind(this, this.getIncompleteSync),
			saveUploadInfo: this.objs.syncAndBind(this, this.saveUploadInfo),
			getUploadInfo: this.objs.syncAndBind(this, this.getUploadInfo),
			removeCurrentObjVersion: this.objs.syncAndBind(this,
				this.removeCurrentObjVersion),
			setRemovalAsSynced: this.objs.syncAndBind(this,
				this.setRemovalAsSynced),
			clearUploadInfo: this.objs.syncAndBind(this, this.clearUploadInfo),
			indicateConflict: this.objs.syncAndBind(this, this.indicateConflict),
			setCurrentSyncedVersion: this.objs.syncAndBind(this,
				this.setCurrentSyncedVersion)
		};
		Object.freeze(w);
		return w;
	}

}
Object.freeze(LocalVersions.prototype);
Object.freeze(LocalVersions);

function noop() {}

export type ReencryptHeader =
	(initHeader: Uint8Array, newVer: number) => Promise<Uint8Array>;

Object.freeze(exports);