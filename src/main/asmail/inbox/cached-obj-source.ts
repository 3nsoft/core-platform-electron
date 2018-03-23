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
import { ByteSource } from '../../../lib-common/byte-streaming/common';
import { syncWrapObjSource }
	from '../../../lib-common/obj-streaming/concurrent';
import { MailRecipient } from '../../../lib-client/asmail/recipient';
import { InboxCache, PartialObjInfo as MsgPartialObjInfo, ObjSize }
	from './cache';
import { missingRegionsIn, splitBigRegions, Region }
	from '../../../lib-client/local-files/regions';
import { Downloader } from './downloader';

class CachedByteSource implements ByteSource {
	
	private segsPointer = 0;
	private segsSize: number;
	
	constructor(
			private cache: InboxCache,
			private downloader: Downloader,
			private msgId: string,
			private objId: string,
			objSize: ObjSize,
			private allBytesInCache: boolean) {
		this.segsSize = objSize.segments;
		Object.seal(this);
	}
	
	async read(len: number): Promise<Uint8Array|undefined> {
		const start = this.segsPointer;
		const end = ((typeof len === 'number') ? (start + len) : this.segsSize);
		if (!this.allBytesInCache) {
			this.allBytesInCache = await this.downloader.ensureSegsAreOnDisk(
				this.msgId, this.objId, start, end);
		}
		const chunk = await this.cache.getMsgObjSegments(
			this.msgId, this.objId, start, end);
		if (!chunk) { return undefined; }
		this.segsPointer += chunk.length;
		return chunk;
	}
	
	async getSize(): Promise<number> {
		return this.segsSize;
	}
	
	async seek(offset: number): Promise<void> {
		if ((typeof offset !== 'number') || (offset < 0)) { throw new Error(
			`Illegal offset is given to seek: ${offset}`); }
		this.segsPointer = Math.min(offset, this.segsSize);
	}

	async getPosition(): Promise<number> {
		return this.segsPointer;
	}

}
Object.freeze(CachedByteSource.prototype);
Object.freeze(CachedByteSource);

class CachedObjSource implements ObjSource {
	
	private segsPointer = 0;

	segSrc: ByteSource;
	
	constructor(
			private cache: InboxCache,
			private downloader: Downloader,
			private msgId: string,
			private objId: string,
			objSize: ObjSize,
			private allBytesInCache: boolean) {
		this.segSrc = new CachedByteSource(
			cache, downloader, msgId, objId, objSize, allBytesInCache);
		Object.seal(this);
	}
	
	version = 0;
	
	async readHeader(): Promise<Uint8Array> {
		if (!this.allBytesInCache) {
			this.allBytesInCache = await this.downloader.ensureHeaderIsOnDisk(
				this.msgId, this.objId);
		}
		const header = await this.cache.getMsgObjHeader(this.msgId, this.objId);
		return header;
	}
	
}
Object.freeze(CachedObjSource.prototype);
Object.freeze(CachedObjSource);

/**
 * @param cache
 * @param downloader
 * @param msgId
 * @param objId
 * @return a promise, resolvable to ObjSource of a given message object.
 */
export async function makeCachedObjSource(cache: InboxCache,
		downloader: Downloader, msgId: string, objId: string):
		Promise<ObjSource> {
	const { onDisk, size } = await downloader.statusOf(msgId, objId);
	const src = new CachedObjSource(cache, downloader, msgId, objId, size, onDisk);
	return Object.freeze(syncWrapObjSource(src));
}

Object.freeze(exports);