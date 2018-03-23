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

import { StorageOwner as RemoteStorageOwner }
	from '../../../lib-client/3nstorage/service';
import { DownloadInfo, SyncedObjVersions } from './files/synced-versions';
import { DiffInfo, ObjId } from './files/objs';
import { splitBigRegions, missingRegionsIn, Region }
	from '../../../lib-client/local-files/regions';
import { NamedProcs } from '../../../lib-common/processes';
import { TimeWindowCache } from '../../../lib-common/time-window-cache';

const MAX_GETTING_CHUNK = 512*1024;
const DOWNLOAD_START_CHUNK = 128*1024;

export interface ObjInfo {
	/**
	 * This is a number of new bytes in this version, i.e. if version is diff-ed
	 * this count does not include bytes from base version.
	 */
	segsSize: number;
	allBytesInCache: boolean;
	diff?: DiffInfo;
}

function toKey(objId: ObjId, version: number): string {
	return `${objId}*${version}`;
}

/**
 * Downloader is responsible for getting objects from server and placing bytes
 * into cache.
 * Note: at this point downloader will be asking every version in its entirety,
 * as downloads as diff's is not implemented.
 */
export class SyncedVersionsDownloader {

	/**
	 * Per-object chained downloads.
	 * When it comes to the download start, if chain exists, it means that
	 * process has already started.
	 */
	private downloadProcs = new NamedProcs();
	
	private progressInfoCache =
		new TimeWindowCache<string, DownloadInfo>(60*1000);

	constructor(
			private synced: SyncedObjVersions,
			private remoteStorage: RemoteStorageOwner) {
		Object.seal(this);
	}

	private async cachingProgressFor(objId: ObjId, version: number):
			Promise<DownloadInfo|undefined> {
		let progr = this.progressInfoCache.get(toKey(objId, version));
		if (progr) { return progr; }
		progr = await this.synced.downloadInfoFor(objId, version);
		if (progr) {
			this.progressInfoCache.set(toKey(objId, version), progr);
		}
		return progr;
	}

	/**
	 * @param objId
	 * @param version
	 * @param start
	 * @param end
	 * @return true, when all bytes are cached, and false, otherwise.
	 */
	async ensureBytesAreOnDisk(objId: ObjId, version: number,
			start: number, end: number): Promise<boolean> {
		const progr = await this.cachingProgressFor(objId, version);
		if (!progr || progr.isDone) { return true; }
		return this.downloadProcs.startOrChain(objId!, async () => {
			// protect from a duplicate action
			let progr = await this.cachingProgressFor(objId, version);
			if (!progr || progr.isDone) { return true; }
			
			// find missing segments regions
			let regionsToGet = missingRegionsIn(start, end, progr.segs);
			if (regionsToGet.length === 0) { return (!progr || !!progr.isDone); }

			// adjust end parameter to guard against tiny network request
			if ((end - start) < MAX_GETTING_CHUNK) {
				end = Math.min(start + MAX_GETTING_CHUNK, progr.segsSize);
				regionsToGet = missingRegionsIn(start, end, progr.segs);
			}

			// download missing segments
			if (regionsToGet.length > 0) {
				await this.downloadSegRegions(objId, version, regionsToGet);
				progr = await this.cachingProgressFor(objId, version);
			}
			
			return (!progr || !!progr.isDone);
		});
	}
	
	private async downloadSegRegions(objId: ObjId, version: number,
			regions: Region[], isCurrent = true): Promise<void> {
		splitBigRegions(regions, MAX_GETTING_CHUNK);
		for (const region of regions) {
			let segsChunk: Uint8Array;
			if (isCurrent) {
				segsChunk = await this.remoteStorage.getCurrentObjSegs(objId,
					version, region.start, region.end);
			} else {
				throw new Error('Getting archived version is not implemented, yet');
			}
			const progr = await this.synced.continueSaving(
				objId, version, region.start, segsChunk);
			this.progressInfoCache.set(toKey(objId, version), progr);
		}
	}

	async getObjInfo(objId: ObjId, version: number): Promise<ObjInfo> {
		const progr = await this.cachingProgressFor(objId, version);
		let info: ObjInfo;
		if (progr) {
			info = {
				allBytesInCache: !!progr.isDone,
				segsSize: progr.segsSize
			};
		} else {
			info = {
				allBytesInCache: true,
				segsSize: await this.synced.reader.getSegsSize(
					objId, version, false)
			};
		}
		const diff = await this.synced.reader.readObjDiff(objId, version);
		if (diff) {
			info.diff = diff;
		}
		return info;
	}

	/**
	 * This method downloads of object's version, either current, or an archived
	 * one. Download may bring a whole object, if it is small enough. If download
	 * is partial, respective download progress info-file is setup.
	 * If an object does not exist, returned promise will fail, and nothing will
	 * be recorded to disk.
	 * @param objId
	 * @param isCurrent is a flag, which default true value asks for current
	 * version, and false value asks for an archived version. In archive case, a
	 * specific version must be given.
	 * @param archVer is an archived version of an objects
	 */
	async startObjDownload(objId: ObjId, isCurrent = true, archVer?: number):
			Promise<void> {
		const proc = this.downloadProcs.getP<void>(objId!);
		if (proc) { return proc; }
		if (isCurrent) {
			return this.downloadProcs.start(objId!, async () => {
				const { header, segsTotalLen, version, segsChunk } =
					await this.remoteStorage.getCurrentObj(objId, DOWNLOAD_START_CHUNK);
				const progress = await this.synced.startSaving(
					objId, version, header, segsChunk, segsTotalLen, true);
				if (progress) {
					this.progressInfoCache.set(toKey(objId, version), progress);
				}
			});
		} else {
			if (typeof archVer !== 'number') { throw new Error(
				'Version is not given for archive download.'); }
			throw new Error('Getting archived version is not implemented, yet');
		}
	}

}
Object.freeze(SyncedVersionsDownloader.prototype);
Object.freeze(SyncedVersionsDownloader);

Object.freeze(exports);