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

import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { ByteSource, BytesFIFOBuffer }
	from '../../../lib-common/byte-streaming/common';
import { syncWrapObjSource }
	from '../../../lib-common/obj-streaming/concurrent';
import { CacheFiles, DiffInfo } from './cache-files';
import { Downloader, ObjInfo } from './downloader';
import { Uploader } from './uploader';

function addToDiffPrecomputedValues(diff: DiffInfo): void {
	let sections = diff.sections;
	let totalLen = 0;
	for (let i=0; i < sections.length; i+=1) {
		let sec = sections[i];
		let secLen = sec[2];
		totalLen += secLen;
		sec[3] = totalLen;
	}
	if (diff.segsSize !== totalLen) { throw new Error(`Given object diff clames total segment length as ${diff.segsSize}, while all sectors add up to ${totalLen}`); }
}

class CachedByteSource implements ByteSource {

	private segsPointer = 0;
	private segsSize: number;
	private allBytesInCache: boolean;
	private diff: DiffInfo;
	private baseSrc: ByteSource = (undefined as any);
	
	constructor(
			private cache: CacheFiles,
			private downloader: Downloader,
			private objId: string,
			private version: number,
			info: ObjInfo) {
		this.segsSize = info.segsSize;
		this.allBytesInCache = info.allBytesInCache;
		if (info.diff) {
			this.diff = info.diff;
			addToDiffPrecomputedValues(this.diff);
		}
		Object.seal(this);
	}

	private async getBaseSrc(): Promise<ByteSource> {
		if (!this.baseSrc) {
			this.baseSrc = (await makeCachedObjSource(this.cache, this.downloader,
				this.objId, this.diff.baseVersion)).segSrc;
		}
		return this.baseSrc;		
	}

	private async getChunk(start, end): Promise<Uint8Array|undefined> {
		if (!this.allBytesInCache) {
			this.allBytesInCache = await this.downloader.ensureBytesAreOnDisk(
				this.objId, this.version, start, end);
		}
		let chunk = await this.cache.readObjSegments(
			this.objId, this.version, start, end);
		if (!chunk) { return undefined; }
		this.segsPointer += chunk.length;
		return chunk;
	}

	private async nonDiffRead(len: number): Promise<Uint8Array|undefined> {
		let start = this.segsPointer;
		let end = ((typeof len === 'number') ? (start + len) : this.segsSize);
		return this.getChunk(start, end);
	}

	private async diffRead(len: number): Promise<Uint8Array|undefined> {
		let start = this.segsPointer;
		let end = ((typeof len === 'number') ?
			(start + len) : this.diff.segsSize);

		// find first and last diff sections
		let fstSecInd = this.diff.sections.findIndex(s => (start < s[3]));
		if (typeof fstSecInd !== 'number') { return undefined; }
		let lastSecInd = this.diff.sections.findIndex(s => (end <= s[3]));
		if (typeof lastSecInd !== 'number') {
			lastSecInd = this.diff.sections.length - 1;
		}
		let fstSec = Array.from(this.diff.sections[fstSecInd]);
		let lastSec = ((fstSecInd === lastSecInd) ?
			fstSec : Array.from(this.diff.sections[lastSecInd]));
		
		// adjust position of first sector to align with start
		let fstSecStart = ((fstSecInd === 0) ?
			0 : this.diff.sections[fstSecInd-1][3]);
		fstSec[1] = fstSec[1] + (start - fstSecStart);
		// adjust length of last sector to align with end
		lastSec[2] = lastSec[2] - (lastSec[3] - end);

		let buf = new BytesFIFOBuffer();
		for (let i=fstSecInd; i <= lastSecInd; i+=1) {
			let s: number[];
			if (i === fstSecInd) { s = fstSec; }
			else if (i === lastSecInd) { s = lastSec; }
			else { s = this.diff.sections[i]; }
			if (s[0] === 0) {
				let baseSrc = await this.getBaseSrc();
				baseSrc.seek!(s[1]);
				let bytes = await baseSrc.read(s[2]);
				if (!bytes || (bytes.length < s[2])) { throw new Error(
					`Base file is too short.`); }
				buf.push(bytes);
			} else {
				let bytes = await this.getChunk(s[1], s[1]+s[2]);
				if (!bytes || (bytes.length < s[2])) { throw new Error(
					`Segments file is too short.`); }
				buf.push(bytes);
			}
		}
		return buf.getBytes(undefined);
	}
	
	read(len: number): Promise<Uint8Array|undefined> {
		if ((typeof len === 'number') && len <= 0) { throw new Error(
			'Illegal length parameter given: '+len); }
		if (this.diff) {
			return this.diffRead(len);
		} else {
			return this.nonDiffRead(len);
		}
	}
	
	async getSize(): Promise<number> {
		return (this.diff ? this.diff.segsSize : this.segsSize);
	}
	
	async seek(offset: number): Promise<void> {
		if ((typeof offset !== 'number') || (offset < 0)) { throw new Error(
			'Illegal offset is given to seek: '+offset); }
		this.segsPointer = Math.min(offset, await this.getSize());
	}

	async getPosition(): Promise<number> {
		return this.segsPointer;
	}
}
Object.freeze(CachedByteSource.prototype);
Object.freeze(CachedByteSource);

class CachedObjSource implements ObjSource {
	
	segSrc: ByteSource;
	
	constructor(
			private cache: CacheFiles,
			downloader: Downloader,
			private objId: string,
			private version: number,
			info: ObjInfo) {
		this.segSrc = new CachedByteSource(cache, downloader,
			objId, version, info);
		Object.seal(this);
	}
	
	getObjVersion(): number {
		return this.version;
	}
	
	async readHeader(): Promise<Uint8Array> {
		let h = await this.cache.readObjHeader(this.objId, this.version);
		return h;
	}
	
}
Object.freeze(CachedObjSource.prototype);
Object.freeze(CachedObjSource);

/**
 * @param cache
 * @param downloader
 * @param objId
 * @param version
 * @return a promise, resolvable to ObjSource of a given object version.
 */
export async function makeCachedObjSource(cache: CacheFiles,
		downloader: Downloader, objId: string, version: number):
		Promise<ObjSource> {
	let info = await downloader.getObjInfo(objId, version);
	let src = new CachedObjSource(cache, downloader, objId, version, info);
	return Object.freeze(syncWrapObjSource(src));
}

Object.freeze(exports);