/*
 Copyright (C) 2016 3NSoft Inc.
 
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
	from '../../lib-client/3nstorage/service';
import { CacheFiles, CachingProgress, DiffInfo } from './cache-files';
import { splitBigRegions, missingRegionsIn, Region }
	from '../../lib-client/local-files/regions';
import { NamedProcs } from '../../lib-common/processes';
import { TimeWindowCache } from '../../lib-common/time-window-cache';

let DEFAULT_MAX_GETTING_CHUNK = 512*1024;

export interface ObjInfo {
	/**
	 * This is a number of new bytes in this version, i.e. if version is diff-ed
	 * this count does not include bytes from base version.
	 */
	segsSize: number;
	allBytesInCache: boolean;
	diff?: DiffInfo;
}

function toKey(objId: string, version: number): string {
	return `${objId}*${version}`;
}

/**
 * Downloader is responsible for getting objects from server and placing bytes
 * into cache.
 * Note: at this point downloader will be asking every version in its entirety,
 * as downloads as diff's is not implemented.
 */
export class Downloader {

	private downloadStartProcs = new NamedProcs();
	private progressInfoCache =
		new TimeWindowCache<string, CachingProgress>(60*1000);

	// XXX have a map with chunks already in requests, so as not to order bytes
	//		twice.

	constructor(
			private files: CacheFiles,
			private remoteStorage: RemoteStorageOwner) {
		Object.seal(this);
	}

	private async cachingProgressFor(objId: string, version: number):
			Promise<CachingProgress> {
		let progr = this.progressInfoCache.get(toKey(objId, version));
		if (progr) { return progr; }
		progr = await this.files.cachingProgressFor(objId, version);
		if (progr) {
			this.progressInfoCache.set(toKey(objId, version), progr);
		}
		return progr;
	}

	async ensureBytesAreOnDisk(objId: string, version: number,
			start: number, end: number): Promise<boolean> {
		let progr = await this.cachingProgressFor(objId, version);
		if (!progr || progr.isDone) { return true; }
		let regionsToGet = missingRegionsIn(start, end, progr.segs);
		let mainDownload = ((regionsToGet.length === 0) ? null :
			this.downloadSegRegions(objId, version, regionsToGet));

		// XXX (issue #44) need a smarter behaviour for dpwnload requests here,
		//		as reads are usually called often and in small 4K chunks, thus,
		//		we should ask for more bytes to be delivered async.
		// Do buffer calculation and downloader request here without waiting
		// for it.

		if (mainDownload) { await mainDownload; }
		progr = await this.cachingProgressFor(objId, version);
		return progr.isDone;
	}
	
	private async downloadSegRegions(objId: string, version: number,
			regions: Region[]): Promise<void> {
		splitBigRegions(regions, DEFAULT_MAX_GETTING_CHUNK);
		for (let region of regions) {
			let { segsChunk } = await this.remoteStorage.getObjSegs(objId,
				version, region.start, region.end - region.start);
			let progr = await this.files.cacheObjSegments(
				objId, version, region.start, segsChunk);
			this.progressInfoCache.set(toKey(objId, version), progr);
		}
	}

	async getObjInfo(objId: string, version: number): Promise<ObjInfo> {
		let progr = await this.cachingProgressFor(objId, version);
		let info: ObjInfo;
		if (progr) {
			info = {
				allBytesInCache: !!progr.isDone,
				segsSize: progr.segsSize
			};
		} else {
			info = {
				allBytesInCache: true,
				segsSize: await this.files.getSegsSize(objId, version, false)
			};
		}
		let diff = await this.files.readObjDiff(objId, version);
		if (diff) {
			info.diff = diff;
		}
		return info;
	}

	/**
	 * This starts download of object's version, either current, or an archived
	 * one. Download start consists of getting object header, saving it, and
	 * setting up download progress info-file.
	 * If an object does not exist, getting header will fail, and nothing will
	 * be recorded to disk.
	 * @param objId
	 * @param isCurrent is a flag, which default true value asks for current
	 * version, and false value asks for an archived version. In archive case, a
	 * specific version must be given.
	 * @param archVer is an archived version of an objects
	 * @return a promise, resolvable when download start completes.
	 */
	async startObjDownload(objId: string, isCurrent = true, archVer?: number):
			Promise<void> {
		let proc = this.downloadStartProcs.getP<void>(objId);
		if (proc) { return proc; }
		if (isCurrent) {
			return this.downloadStartProcs.start(objId, async () => {
				let { header, segsTotalLen, version } =
					await this.remoteStorage.getObjHeader(objId);
				let progress = await this.files.startCachingObj(
					objId, version, header, segsTotalLen, true);
				this.progressInfoCache.set(toKey(objId, version), progress);
			});
		} else {
			if (typeof archVer !== 'number') { throw new Error(
				'Version is not given for archive download.'); }
			return this.downloadStartProcs.start(objId, async () => {
				let res = await this.remoteStorage.getObjHeader(objId, archVer);
				let progress = await this.files.startCachingObj(
					objId, res.version, res.header, res.segsTotalLen, false);
				this.progressInfoCache.set(toKey(objId, archVer), progress);
			});
		}
	}

}
Object.freeze(Downloader.prototype);
Object.freeze(Downloader);

Object.freeze(exports);