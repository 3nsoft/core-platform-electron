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

import { mergeRegions } from '../../../../lib-client/local-files/regions';
import { parseObjFileOffsets, writeObjTo }
	from '../../../../lib-client/obj-file-on-dev-fs';
import { ObjId, Objs, notFoundOrReThrow, DiffInfo, ObjStatusInfo }
	from './objs';
import { ObjReader, ObjFileReader } from './obj-reader';
import { FileException } from '../../../../lib-common/exceptions/file';

/**
 * This is an extention for a download info file. File name starts with a
 * version that is being downloaded. When download of a version is complete,
 * this info file is removed.
 */
const DOWNLOAD_INFO_FILE_EXT = 'download';

export interface DownloadInfo {
	segsSize: number;
	segs: { start: number; end: number; }[];
	isDone?: boolean;
}

export interface SyncedObjVersions {
	
	/**
	 * This function promises to return either download info for a given id and
	 * version pair, if it is being downloaded, or an undefined, otherwise.
	 * @param objId
	 * @param version specifying required object version
	 */
	downloadInfoFor(objId: ObjId, version: number):
		Promise<DownloadInfo|undefined>;
	
	/**
	 * This function caches an object by storing given header and segments chunk.
	 * Returned promise resolves to an undefined, when segments are completely
	 * given, making it complete saving, and a download info, when only chunk of
	 * segments is given.
	 * @param objId
	 * @param version
	 * @param header is a complete header byte array
	 * @param segsChunk is a segmenta byte array that starts segments, i.e. with
	 * segs offset 0. It may or may not be a complete segments array.
	 * @param segsSize is a total size of segments
	 * @param isCurrent if true, will set this given version as current,
	 * otherwise set as archived
	 */
	startSaving(objId: ObjId, version: number, header: Uint8Array,
		segsChunk: Uint8Array, segsSize: number, isCurrent: boolean):
		Promise<DownloadInfo|undefined>;
	
	/**
	 * This function saves given segments' chunk. Returned promise resolves to an
	 * updated download info.
	 * @param objId
	 * @param version
	 * @param offset is an offset into segments from where writting should start
	 * @param bytes is segments' chunk
	 */
	continueSaving(objId: ObjId, version: number, offset: number,
		bytes: Uint8Array): Promise<DownloadInfo>;

	reader: ObjReader;

	/**
	 * This function sets given object version as current, coming from server.
	 * Returned promise resolves either to true, when current version is set to
	 * new value, or to false, otherwise.
	 * @param objId
	 * @param version
	 * @param createInfoIfMissing if true, function will create status, when it
	 * is missing in existing object folder. Default value is false.
	 */
	setCurrentRemoteVersion(objId: ObjId, version: number,
		createInfoIfMissing?: boolean): Promise<boolean>;

	/**
	 * This function removes current object's version, and triggers gc.
	 * @param objId
	 */
	removeCurrentObjVersion(objId: ObjId): Promise<void>;

}

export class SyncedVersions implements SyncedObjVersions {
	
	reader: ObjFileReader;

	constructor(
			private objs: Objs) {
		this.reader = new ObjFileReader(this.objs, 'synced');
		Object.freeze(this);
	}

	async startSaving(objId: ObjId, version: number, header: Uint8Array,
			segsChunk: Uint8Array, segsSize: number, isCurrent: boolean):
			Promise<DownloadInfo|undefined> {
		if (segsSize < segsChunk.length) { throw new Error(
			`Illegal parameters: total segs length smaller than a given chunk`); }
		const objFolder = await this.objs.getOrMakeObjFolder(objId);
		
		if (isCurrent) {
			await this.setCurrentRemoteVersion(objId, version, true);
			this.objs.gc.scheduleCollection(objId);
		} else {
			await this.objs.setArchivedVersion(objId, version, true);
		}

		const sink = await this.objs.fs.getByteSink(`${objFolder}/${version}.`);
		await writeObjTo(sink, undefined, header, segsChunk);
		if (segsSize > segsChunk.length) {
			const segsOffset = 8 + header.length;
			await sink.setSize(segsOffset + segsSize);
		}
		sink.write(null);

		let objProgress: DownloadInfo|undefined = undefined;
		if (segsChunk.length < segsSize) {
			objProgress = { segsSize, segs: [] };
			await this.objs.fs.writeJSONFile(
				`${objFolder}/${version}.${DOWNLOAD_INFO_FILE_EXT}`, objProgress);
		}
		return objProgress;
	}

	async downloadInfoFor(objId: ObjId, version: number):
			Promise<DownloadInfo|undefined> {
		const objFolder = await this.objs.getObjFolder(objId);
		const progressFile = `${objFolder}/${version}.${DOWNLOAD_INFO_FILE_EXT}`;
		return this.objs.fs.readJSONFile<DownloadInfo>(progressFile)
		.catch(notFoundOrReThrow);
	}
	
	private async updateCachingProgressInfo(objFolder: string, version: number,
			info: DownloadInfo, start: number, end: number):
			Promise<DownloadInfo> {
		mergeRegions(info.segs, { start, end });
		const partialFile = `${objFolder}/${version}.${DOWNLOAD_INFO_FILE_EXT}`;
		if ((info.segs.length === 1) && (info.segs[0].start === 0) &&
				(info.segs[0].end === info.segsSize)) {
			await this.objs.fs.deleteFile(partialFile);
			info.isDone = true;
		} else {
			await this.objs.fs.writeJSONFile(partialFile, info);
		}
		return info;
	}
	
	async continueSaving(objId: ObjId, version: number, offset: number,
			bytes: Uint8Array): Promise<DownloadInfo> {
		const objFolder = await this.objs.getObjFolder(objId);
		if (!objFolder) { throw new Error(
			`Broken expectation of object folder presence.`); }
		const objStat = await this.objs.fs.readJSONFile<DownloadInfo>(
			`${objFolder}/${version}.${DOWNLOAD_INFO_FILE_EXT}`);
		const path = `${objFolder}/${version}.`;
		const { segsOffset } = await parseObjFileOffsets(this.objs.fs, path);
		const sink = await this.objs.fs.getByteSink(path);
		sink.seek!(offset+segsOffset);
		const bytesLen = bytes.length;
		await sink.write(bytes);
		return await this.updateCachingProgressInfo(
			objFolder, version, objStat, offset, offset+bytesLen);
	}

	async setCurrentRemoteVersion(objId: ObjId, version: number,
			createInfoIfMissing = false): Promise<boolean> {
		const objFolder = await this.objs.getObjFolder(objId, false);
		if (!objFolder) { return false; }

		const status = await this.objs.getObjStatus(objId, objFolder)
		.catch((exc: FileException) => {
			if (!exc.notFound || !createInfoIfMissing) { throw exc; }
			const newStatus: ObjStatusInfo = {
				objId,
				syncState: 'synced'
			};
			return newStatus;
		});

		if (status.current) {
			if (status.current.isLocal) {
				if (status.conflictingRemVer
					&& (status.conflictingRemVer >= version)) { return false; }
				status.conflictingRemVer = version;
				status.syncState = 'conflicting';
				await this.objs.setObjStatus(status, objFolder);
				return false;
			} else {
				if (status.current.version >= version) { return false; }
				status.current.version = version;
			}
		} else {
			status.current = { version, isLocal: false };
		}
		status.latestSynced = version;
		status.syncState = 'synced';
		await this.objs.setObjStatus(status, objFolder);
		this.objs.gc.scheduleCollection(objId);
		return true;
	}

	async removeCurrentObjVersion(objId: ObjId): Promise<void> {
		await this.objs.removeCurrentObjVersion(objId, false);
		this.objs.gc.scheduleCollection(objId);
	}

	wrap(): SyncedObjVersions {
		const w: SyncedObjVersions = {
			reader: this.reader.wrap(),
			downloadInfoFor: this.objs.syncAndBind(this, this.downloadInfoFor),
			startSaving: this.objs.syncAndBind(this, this.startSaving),
			continueSaving: this.objs.syncAndBind(this, this.continueSaving),
			setCurrentRemoteVersion: this.objs.syncAndBind(this,
				this.setCurrentRemoteVersion),
			removeCurrentObjVersion: this.objs.syncAndBind(this,
				this.removeCurrentObjVersion)
		};
		Object.freeze(w);
		return w;
	}

}
Object.freeze(SyncedVersions.prototype);
Object.freeze(SyncedVersions);

Object.freeze(exports);