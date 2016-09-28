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

import { FS } from '../../lib-client/local-files/device-fs';
import { CacheOfFolders, makeObjSourceFromByteSources }
	from '../../lib-client/local-files/generational-cache';
import { ObjSource }
	from '../../lib-common/obj-streaming/common';
import { MsgMeta, ObjSize }
	from '../../lib-common/service-api/asmail/retrieval';
import { bind } from '../../lib-common/binding';
import { mergeRegions } from '../../lib-client/local-files/regions';

export { ObjSize }
	from '../../lib-common/service-api/asmail/retrieval';

export interface InboxCache {
	
	/**
	 * @param msgId
	 * @return a promise, resolvable to message meta.
	 */
	getMsgMeta(msgId: string): Promise<MsgMeta>;
	
	/**
	 * @param msgId
	 * @param meta
	 * @return a promise, resolvable when message meta is recorded.
	 */
	startSavingMsg(msgId: string, meta: MsgMeta): Promise<void>;
	
	/**
	 * @param msgId
	 * @param objId
	 * @return a promise, resolvable to object's header bytes.
	 */
	getMsgObjHeader(msgId: string, objId: string): Promise<Uint8Array>;
	
	/**
	 * Use this for an object that is known to be completely in cache.
	 * Caller must check message's status for this.
	 * @param msgId
	 * @param objId
	 * @return a promise, resolvable to ObjByteSource of an object that is
	 * completely cached.
	 */
	getMsgObj(msgId: string, objId: string): Promise<ObjSource>;
	
	/**
	 * @param msgId
	 * @param objId
	 * @return a promise, resolvable to ByteSource of object's segments.
	 */
	getMsgObjSegments(msgId: string, objId: string, start: number,
			end: number): Promise<Uint8Array>;
	
	/**
	 * @param msgId
	 * @return a promise, resolvable when message folder is deleted.
	 */
	deleteMsg(msgId: string): Promise<void>;
	
	/**
	 * @param msgId
	 * @param objId
	 * @param bytes of object's header
	 * @return a promise, resolvable to object info, when all header bytes are
	 * saved to cache. When object is complete, promise resolves to null.
	 */
	saveMsgObjHeader(msgId: string, objId: string, bytes: Uint8Array):
		Promise<PartialObjInfo>;
	
	/**
	 * @param msgId
	 * @param objId
	 * @param offset in segments, at which writing should start
	 * @param bytes
	 * @return a promise, resolvable to object info, when all segment bytes are
	 * saved to cache. When object is complete, promise resolves to null.
	 */
	saveMsgObjSegs(msgId: string, objId: string, offset: number,
		bytes: Uint8Array): Promise<PartialObjInfo>;
	
	/**
	 * @param msgId
	 * @param objId
	 * @param header is a complete header byte array
	 * @param segments is a byte array with all segment
	 * @return a promise, resolvable when saving to cache is done.
	 */
	saveCompleteObj(msgId: string, objId: string, header: Uint8Array,
		segments: Uint8Array): Promise<void>;
	
	/**
	 * @param msgId
	 * @return a promise, resolvable to cache status of a message.
	 */
	getMsgStatus(msgId: string): Promise<MsgStatus>;
	
}

export const MSG_STATUS = {
	noMsgKey: 'msg key not found',
	justMeta: 'only msg meta downloaded',
	partial: 'partially downloaded',
	complete: 'completely downloaded'
};
Object.freeze(MSG_STATUS);

export interface PartialObjInfo {
	headerDone?: boolean;
	segs: { start: number; end: number; }[];
}

export interface MsgStatus {
	status: string;
	completeObjs?: { [objId: string]: ObjSize; };
	partialObjInfos?: { [objId: string]: PartialObjInfo };
	incompleteObjs?: { [objId: string]: ObjSize; };
}

const META_FNAME = 'meta.json';
const STATUS_FNAME = 'status.json';
const HEADER_FILE_EXT = '.hxsp';
const SEGMENTS_FILE_EXT = '.sxsp';

const CACHE_ROTATION_HOURS = 12;

function changeMsgStatusIfObjComplete(msgStatus: MsgStatus, objId: string,
		uncondtionallyComplete = false): void {
	let info = (msgStatus.partialObjInfos ?
		msgStatus.partialObjInfos[objId] : null);
	let objSize = msgStatus.incompleteObjs[objId];
	if (uncondtionallyComplete ||
			(info.headerDone && (info.segs.length === 1) &&
			(info.segs[0].start === 0) &&
			(info.segs[0].end >= objSize.segments))) {
		if (!msgStatus.completeObjs) { msgStatus.completeObjs = {}; }
		msgStatus.completeObjs[objId] = objSize;
		if (msgStatus.partialObjInfos) {
			delete msgStatus.partialObjInfos[objId];
		}
		delete msgStatus.incompleteObjs[objId];
		if (Object.keys(msgStatus.incompleteObjs).length === 0) {
			msgStatus.status = MSG_STATUS.complete;
			delete msgStatus.incompleteObjs;
			delete msgStatus.partialObjInfos;
		}
		
	}	
}

class InboxFiles implements InboxCache {
	
	private cache: CacheOfFolders = null;
	
	constructor(
			private fs: FS) {
		Object.seal(this);
	}
	
	async init(): Promise<void> {
		this.cache = new CacheOfFolders(this.fs);
		Object.freeze(this);
		await this.cache.init(CACHE_ROTATION_HOURS);
	}
	
	async getMsgMeta(msgId: string): Promise<MsgMeta> {
		let unlock = await this.cache.accessLock();
		try {
			let msgFolder = await this.cache.getFolder(msgId);
			return await this.fs.readJSONFile<MsgMeta>(
				msgFolder+'/'+META_FNAME);
		} finally {
			unlock();
		}
	}
	
	async getMsgObj(msgId: string, objId: string): Promise<ObjSource> {
		let unlock = await this.cache.accessLock();
		try {
			let msgFolder = await this.cache.getFolder(msgId);
			let s = await this.fs.getByteSource(
				msgFolder+'/'+objId+SEGMENTS_FILE_EXT);
			return makeObjSourceFromByteSources(() => {
				return this.getMsgObjHeader(msgId, objId);
			}, s, 1);	// note: version === 1 for all msg objects
		} finally {
			unlock();
		}
	}
	
	async getMsgObjHeader(msgId: string, objId: string): Promise<Uint8Array> {
		let unlock = await this.cache.accessLock();
		try {
			let msgFolder = await this.cache.getFolder(msgId);
			return await this.fs.readBytes(msgFolder+'/'+objId+HEADER_FILE_EXT);
		} finally {
			unlock();
		}
	}
	
	async getMsgObjSegments(msgId: string, objId: string, start: number,
			end: number): Promise<Uint8Array> {
		let unlock = await this.cache.accessLock();
		try {
			let msgFolder = await this.cache.getFolder(msgId);
			return await this.fs.readBytes(
				msgFolder+'/'+objId+SEGMENTS_FILE_EXT, start, end);
		} finally {
			unlock();
		}
	}
	
	async getMsgStatus(msgId: string): Promise<MsgStatus> {
		let unlock = await this.cache.accessLock();
		try {
			let msgFolder = await this.cache.getFolder(msgId);
			return await this.fs.readJSONFile<MsgStatus>(
				msgFolder+'/'+STATUS_FNAME);
		} finally {
			unlock();
		}
	}
	
	async startSavingMsg(msgId: string, meta: MsgMeta): Promise<void> {
		let unlock = await this.cache.accessLock();
		try {
			let msgFolder = await this.cache.makeNewFolder(msgId);
			await this.fs.writeJSONFile(msgFolder+'/'+META_FNAME, meta);
			let mst: MsgStatus = {
				status: MSG_STATUS.justMeta,
				incompleteObjs: meta.objSizes
			};
			await this.fs.writeJSONFile(msgFolder+'/'+STATUS_FNAME, mst);
		} finally {
			unlock();
		}
	}
	
	private updateObjStatusOnCompleteSaving(msgFolder: string,
			objId: string, msgStatus: MsgStatus): Promise<void> {
		changeMsgStatusIfObjComplete(msgStatus, objId, true);
		return this.fs.writeJSONFile(msgFolder+'/'+STATUS_FNAME, msgStatus);
	}
	
	async saveCompleteObj(msgId: string, objId: string, header: Uint8Array,
			segments: Uint8Array): Promise<void> {
		let unlock = await this.cache.accessLock();
		try {
			let msgFolder = await this.cache.getFolder(msgId);
			let msgStat = await this.checkObjStatusForUpdate(msgFolder, objId);
			await this.fs.writeBytes(msgFolder+'/'+objId+HEADER_FILE_EXT, header);
			await this.fs.writeBytes(
				msgFolder+'/'+objId+SEGMENTS_FILE_EXT, segments);
			await this.updateObjStatusOnCompleteSaving(msgFolder, objId, msgStat);
		} finally {
			unlock();
		}
	}
	
	async deleteMsg(msgId: string): Promise<void> {
		let unlock = await this.cache.accessLock();
		try {
			await this.cache.removeFolder(msgId);
		} finally {
			unlock();
		}
	}
	
	private async checkObjStatusForUpdate(msgFolder: string, objId: string):
			Promise<MsgStatus> {
		let msgStat = await this.fs.readJSONFile<MsgStatus>(
			msgFolder+'/'+STATUS_FNAME);
		if ((msgStat.status !== MSG_STATUS.justMeta) &&
				(msgStat.status !== MSG_STATUS.partial)) {
			throw new Error('Cache message has incompatible status for '+
				'object update "'+msgStat.status+'".');
		} else if (msgStat.completeObjs && msgStat.completeObjs[objId]) {
			throw new Error('Message object is already marked as complete.');
		} else if (!msgStat.incompleteObjs || !msgStat.incompleteObjs[objId]) {
			throw new Error('Object '+objId+' is not known in message '+msgFolder);
		}
		return msgStat;
	}
	
	private async updateObjStatusOnHeaderSaving(msgFolder: string,
			objId: string, msgStatus: MsgStatus): Promise<PartialObjInfo> {
		if (!msgStatus.partialObjInfos) {
			msgStatus.partialObjInfos = {};
		}
		let info = msgStatus.partialObjInfos[objId];
		if (info) {
			info.headerDone = true;
		} else {
			info = {
				headerDone: true,
				segs: []
			};
			msgStatus.partialObjInfos[objId] = info;
		}
		changeMsgStatusIfObjComplete(msgStatus, objId);
		await this.fs.writeJSONFile(msgFolder+'/'+STATUS_FNAME, msgStatus);
		info = msgStatus.partialObjInfos[objId];
		return (info ? info : null);
	}
	
	async saveMsgObjHeader(msgId: string, objId: string, bytes: Uint8Array):
			Promise<PartialObjInfo> {
		let unlock = await this.cache.accessLock();
		try {
			let msgFolder = await this.cache.getFolder(msgId);
			let msgStat = await this.checkObjStatusForUpdate(msgFolder, objId);
			await this.fs.writeBytes(msgFolder+'/'+objId+HEADER_FILE_EXT, bytes);
			return await this.updateObjStatusOnHeaderSaving(
				msgFolder, objId, msgStat);
		} finally {
			unlock();
		}
	}
	
	private async updateObjStatusOnSegSaving(msgFolder: string, objId: string,
			msgStatus: MsgStatus, start: number, end: number):
			Promise<PartialObjInfo> {
		if (!msgStatus.partialObjInfos) {
			msgStatus.partialObjInfos = {};
		}
		let info = msgStatus.partialObjInfos[objId];
		if (info) {
			mergeRegions(info.segs, { start, end });
		} else {
			info = {
				headerDone: false,
				segs: [ { start, end } ]
			};
			msgStatus.partialObjInfos[objId] = info;
		}
		changeMsgStatusIfObjComplete(msgStatus, objId);
		await this.fs.writeJSONFile(msgFolder+'/'+STATUS_FNAME, msgStatus);
		if (!msgStatus.partialObjInfos) {return null;}
		info = msgStatus.partialObjInfos[objId];
		return (info ? info : null);
	}
	
	async saveMsgObjSegs(msgId: string, objId: string, offset: number,
			bytes: Uint8Array): Promise<PartialObjInfo> {
		let unlock = await this.cache.accessLock();
		try {
			let msgFolder = await this.cache.getFolder(msgId);
			let msgStat = await this.checkObjStatusForUpdate(msgFolder, objId);
			let sink = await this.fs.getByteSink(
				msgFolder+'/'+objId+SEGMENTS_FILE_EXT);
			sink.seek(offset);
			let bytesLen = bytes.length;
			await sink.write(bytes);
			return await this.updateObjStatusOnSegSaving(
				msgFolder, objId, msgStat, offset, offset+bytesLen);
		} finally {
			unlock();
		}
	}
	
	wrap(): InboxCache {
		let wrap: InboxCache = {
			deleteMsg: bind(this, this.deleteMsg),
			getMsgMeta: bind(this, this.getMsgMeta),
			getMsgObj: bind(this, this.getMsgObj),
			getMsgObjSegments: bind(this, this.getMsgObjSegments),
			getMsgObjHeader: bind(this, this.getMsgObjHeader),
			saveMsgObjSegs: bind(this, this.saveMsgObjSegs),
			startSavingMsg: bind(this, this.startSavingMsg),
			saveMsgObjHeader: bind(this, this.saveMsgObjHeader),
			getMsgStatus: bind(this, this.getMsgStatus),
			saveCompleteObj: bind(this, this.saveCompleteObj)
		};
		Object.freeze(wrap);
		return wrap;
	}
	
}
Object.freeze(InboxFiles.prototype);
Object.freeze(InboxFiles);

export async function makeInboxCache(cacheFS: FS): Promise<InboxCache> {
	let cache = new InboxFiles(cacheFS);
	await cache.init();
	return cache.wrap();
}

Object.freeze(exports);