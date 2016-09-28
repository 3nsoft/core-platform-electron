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

import { ObjSource } from '../../lib-common/obj-streaming/common';
import { ByteSource } from '../../lib-common/byte-streaming/common';
import { syncWrapObjSource } from '../../lib-common/obj-streaming/concurrent';
import { MailRecipient } from '../../lib-client/asmail/recipient';
import { InboxCache, PartialObjInfo as MsgPartialObjInfo,
	MSG_STATUS as MSG_CACHE_STATUS, ObjSize }
	from './inbox-cache';
import { missingRegionsIn, splitBigRegions, Region }
	from '../../lib-client/local-files/regions';

let DEFAULT_MAX_GETTING_CHUNK = 512*1024;

// XXX 
class CachedByteSource implements ByteSource {
	
	private segsPointer = 0;
	
	constructor(
			private msgReceiver: MailRecipient,
			private cache: InboxCache,
			public msgId: string,
			public objId: string,
			private objSize: ObjSize,
			private partialSize: MsgPartialObjInfo) { 
		Object.seal(this);
	}
	
	private async getFromServerAndCacheChunks(chunks: Region[]): Promise<void> {
		splitBigRegions(chunks, DEFAULT_MAX_GETTING_CHUNK);
		for (let chunk of chunks) {
			let bytes = await this.msgReceiver.getObjSegs(this.msgId, this.objId,
				{ ofs: chunk.start, len: (chunk.end - chunk.start) });
			this.partialSize = await this.cache.saveMsgObjSegs(
				this.msgId, this.objId, chunk.start, bytes);
		}
	}
	
	async read(len: number): Promise<Uint8Array> {
		if (this.segsPointer >= this.objSize.segments) { return null; }
		let start = this.segsPointer;
		let end = ((typeof len === 'number') ?
			(start + len) : this.objSize.segments);
		// XXX need a smarter behaviour for network here, as reads are usually
		//		called in 4K chunks, we should ask for more bytes. Say, 64K.
		//		At the moment, we replace chunked downloads with get a whole thing
		//		approach, by forcing complete regions, if at least any region needs
		//		to be downloaded.
		//		Or, it has to play with downloader, and prepareBytes heads-up
		//		method
		let regionsToGet = missingRegionsIn(start, end, this.partialSize.segs);
		if (regionsToGet.length > 0) {
			// await this.getFromServerAndCacheChunks(regionsToGet);
			await this.getFromServerAndCacheChunks([
				{ start: 0, end: this.objSize.segments }]);
		}
		let chunk = await this.cache.getMsgObjSegments(
			this.msgId, this.objId, start, end);
		this.segsPointer += chunk.length;
		return chunk;
	}
	
	async getSize(): Promise<number> {
		return this.objSize.segments;
	}
	
	async seek(offset: number): Promise<void> {
		this.segsPointer = offset;
	}

	async getPosition(): Promise<number> {
		return this.segsPointer;
	}
	// XXX recipient for sendMsg as 1st arg, removing it from outgoing msg object
}
Object.freeze(CachedByteSource.prototype);
Object.freeze(CachedByteSource);

class CachedObjSource implements ObjSource {
	
	private segsPointer = 0;

	segSrc: ByteSource;
	
	constructor(
			private msgReceiver: MailRecipient,
			private cache: InboxCache,
			public msgId: string,
			public objId: string,
			private objSize: ObjSize,
			private partialSize: MsgPartialObjInfo) {
		this.segSrc = new CachedByteSource(
			msgReceiver, cache, msgId, objId, objSize,partialSize);
		Object.seal(this);
	}
	
	getObjVersion(): number {
		return null;
	}
	
	async readHeader(): Promise<Uint8Array> {
		if (this.partialSize.headerDone) {
			return this.cache.getMsgObjHeader(this.msgId, this.objId);
		}
		let header = await this.msgReceiver.getObjHead(this.msgId, this.objId);
		this.partialSize = await this.cache.saveMsgObjHeader(
			this.msgId, this.objId, new Uint8Array(header));
		return header;
	}
	
}
Object.freeze(CachedObjSource.prototype);
Object.freeze(CachedObjSource);

export async function makeCachedObjSource(msgReceiver: MailRecipient,
		cache: InboxCache, msgId: string, objId: string): Promise<ObjSource> {
	let msgStatus = await cache.getMsgStatus(msgId);
	if (msgStatus.status === MSG_CACHE_STATUS.complete) {
		return cache.getMsgObj(msgId, objId);
	} else if ((msgStatus.status === MSG_CACHE_STATUS.partial) ||
			(msgStatus.status === MSG_CACHE_STATUS.justMeta)) {
		if (msgStatus.completeObjs && msgStatus.completeObjs[objId]) {
			return cache.getMsgObj(msgId, objId);
		} else {
			let objSize = msgStatus.incompleteObjs[objId];
			if (!objSize) { throw new Error(
				'Object '+objId+' is unknown in message '+msgId); }
			let partialSize: MsgPartialObjInfo;
			if (msgStatus.partialObjInfos) {
				partialSize = msgStatus.partialObjInfos[objId];
			}
			if (!partialSize) {
				partialSize = {
					segs: []
				};
			}
			return Object.freeze(syncWrapObjSource(new CachedObjSource(
				msgReceiver, cache, msgId, objId, objSize, partialSize)));
		}
	} else {
		throw new Error('Message obj "'+this.objId+
			'" has an unexpected state: '+msgStatus.status);
	}
}

Object.freeze(exports);