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

import { WritableFS } from '../../../lib-client/local-files/device-fs';
import { CacheOfFolders, makeObjSourceFromByteSources,
	Exception as CacheException }
	from '../../../lib-client/local-files/generational-cache';
import { ObjSource }
	from '../../../lib-common/obj-streaming/common';
import { MsgMeta }
	from '../../../lib-common/service-api/asmail/retrieval';
import { mergeRegions } from '../../../lib-client/local-files/regions';
import { TimeWindowCache } from '../../../lib-common/time-window-cache';
import { bind } from '../../../lib-common/binding';

export { MsgMeta }
	from '../../../lib-common/service-api/asmail/retrieval';

export interface PartialObjInfo {
	headerDone?: boolean;
	segs: { start: number; end: number; }[];
}

export type MsgKeyStatus = 'not-checked' | 'not-found' | 'fail' | 'ok';

export interface ObjSize {
	header: number;
	segments: number;
}

export interface MsgStatus {
	msgId: string;
	keyStatus: MsgKeyStatus;
	onDisk: boolean;
	mainObjId: string;
	deliveryTS: number;
	objs: {
		[objId: string]: {
			size: ObjSize;
			/**
			 * When object is completely on the disk, this field with partial info
			 * will not be present.
			 */
			partial?: PartialObjInfo;
		}
	};
}

const META_FNAME = 'meta.json';
const STATUS_FNAME = 'status.json';
const HEADER_FILE_EXT = '.hxsp';
const SEGMENTS_FILE_EXT = '.sxsp';

const CACHE_ROTATION_HOURS = 12;

function changeMsgStatusIfObjComplete(msgStatus: MsgStatus, objId: string):
		void {
	if (msgStatus.onDisk) { return; }
	
	const objInfo = msgStatus.objs[objId];
	
	// check completness of a given object, and update status, if it is
	const partial = objInfo.partial;
	if (partial) {
		if (!partial.headerDone || (partial.segs.length !== 1) ||
				(partial.segs[0].start !== 0) ||
				(partial.segs[0].end < objInfo.size.segments)) {
			return;
		} else {
			delete objInfo.partial;
		}
	}

	// check that downloads of other objects are also complete
	for (const id of Object.keys(msgStatus.objs)) {
		if (msgStatus.objs[id].partial) { return; } 
	}

	// set whole message as complete
	msgStatus.onDisk = true;
}

export interface InboxCache {
	/**
	 * This method returns a promise of either a cache status of a message, or an
	 * undefined, when message is not found in the cache.
	 * @param msgId
	 * @param throwIfMissing is an optional flag which true value forces
	 * throwing an error, if message is not found in the cache.
	 * Default value is false, i.e. no throwing.
	 */
	findMsg(msgId: string, throwIfMissing?: boolean):
		Promise<MsgStatus|undefined>;

	/**
	 * This method asynchronously updates key status of a message.
	 * @param msgId
	 * @param newStatus
	 */
	updateMsgKeyStatus(msgId: string, newStatus: MsgKeyStatus): Promise<void>;
	
	/**
	 * This returns a promise of message's meta.
	 * @param msgId
	 */
	getMsgMeta(msgId: string): Promise<MsgMeta>;

	/**
	 * This returns a promise of message's object's header.
	 * @param msgId
	 * @param objId
	 */
	getMsgObjHeader(msgId: string, objId: string): Promise<Uint8Array>;
	
	/**
	 * This returns a promise of segments' bytes, or of an undefined, if read is
	 * outside of segments' size.
	 * @param msgId
	 * @param objId
	 */
	getMsgObjSegments(msgId: string, objId: string, start: number, end: number):
		Promise<Uint8Array|undefined>;
	
	/**
	 * This records message meta to a newly created message folder. An exception
	 * is thrown, if a message folder for a given id already exists.
	 * @param msgId
	 * @param meta
	 */
	startSavingMsg(msgId: string, meta: MsgMeta): Promise<void>;
	
	/**
	 * This deletes message folder.
	 * @param msgId
	 */
	deleteMsg(msgId: string): Promise<void>;
	
	/**
	 * This asynchronously saves message's object's header, updating
	 * message status accordingly.
	 * @param msgId
	 * @param objId
	 * @param bytes of object's header
	 */
	saveMsgObjHeader(msgId: string, objId: string, bytes: Uint8Array):
		Promise<void>;
	
	/**
	 * This asynchronously saves message's object's segment bytes, updating
	 * message status accordingly.
	 * @param msgId
	 * @param objId
	 * @param offset in segments, at which writing should start
	 * @param bytes
	 */
	saveMsgObjSegs(msgId: string, objId: string, offset: number,
		bytes: Uint8Array): Promise<void>;
	
}

export class InboxFiles implements InboxCache {
	
	private cache: CacheOfFolders = (undefined as any);
	
	private msgStatusCache =
		new TimeWindowCache<string, MsgStatus>(60*1000);
	
	constructor(
			private fs: WritableFS) {
		Object.seal(this);
	}
	
	async init(): Promise<void> {
		this.cache = new CacheOfFolders(this.fs);
		Object.freeze(this);
		await this.cache.init(CACHE_ROTATION_HOURS);
	}

	async findMsg(msgId: string, throwIfMissing = false):
			Promise<MsgStatus|undefined> {
		let msgStatus = this.msgStatusCache.get(msgId);
		if (!msgStatus) {
			await this.cache.folderProcs.startOrChain(msgId, async () => {
				const msgFolder = await this.cache.getFolder(msgId)
				.catch((exc: CacheException) => {
					if (throwIfMissing || (exc.type !== 'cache') ||
							!exc.notFound) {
						throw exc;
					}
				});
				if (!msgFolder) { return; }
				msgStatus = await this.fs.readJSONFile<MsgStatus>(
					`${msgFolder}/${STATUS_FNAME}`);
			});
			this.msgStatusCache.set(msgId, msgStatus!);
		}
		return msgStatus;
	}

	async updateMsgKeyStatus(msgId: string, newStatus: MsgKeyStatus):
			Promise<void> {
		if (newStatus === 'not-checked') { throw new Error(`New key status cannot be ${newStatus}.`); }
		const msgStatus = (await this.findMsg(msgId, true))!;
		if (msgStatus.keyStatus === 'not-checked') {
			msgStatus.keyStatus = newStatus;
		} else {
			throw Error(`Message has key status ${msgStatus.keyStatus}, and cannot be updated to ${newStatus}`);
		}
		await this.cache.folderProcs.startOrChain(msgId, async () => {
			// make new message folder, throwing if message is already known
			const msgFolder = await this.cache.getFolder(msgId);
			this.updateMsgStatus(msgId, msgStatus, msgFolder);
		});
	}

	private async updateMsgStatus(msgId: string, msgStatus: MsgStatus,
			msgFolder: string): Promise<void> {
		this.msgStatusCache.set(msgId, msgStatus);
		await this.fs.writeJSONFile(`${msgFolder}/${STATUS_FNAME}`, msgStatus);
	}

	/**
	 * @param method is cache user's method, that should be synced and bind.
	 * Synchronization is done via chaining every execution under object id,
	 * which must be the first parameter of each invocation.
	 */
	private syncAndBind<T extends Function>(method: T): T {
		return <T> <any> ((...args: any[]) => {
			const objId = args[0];
			return this.cache.folderProcs.startOrChain<any>(objId, () => {
				return method.apply(this, args);
			});
		});
	}
	
	async getMsgMeta(msgId: string): Promise<MsgMeta> {
		const msgFolder = await this.cache.getFolder(msgId);
		return this.fs.readJSONFile<MsgMeta>(`${msgFolder}/${META_FNAME}`);
	}
	
	async getMsgObjHeader(msgId: string, objId: string): Promise<Uint8Array> {
		const msgFolder = await this.cache.getFolder(msgId);
		const h = await this.fs.readBytes(
			msgFolder+'/'+objId+HEADER_FILE_EXT);
		if (!h) { throw new Error(`Empty object header in file for object ${objId} in a message ${msgId}`); }
		return h;
	}
	
	async getMsgObjSegments(msgId: string, objId: string, start: number,
			end: number): Promise<Uint8Array|undefined> {
		const msgFolder = await this.cache.getFolder(msgId);
		return this.fs.readBytes(
			`${msgFolder}/${objId}${SEGMENTS_FILE_EXT}`, start, end);
	}
	
	async startSavingMsg(msgId: string, meta: MsgMeta): Promise<void> {
		// make new message folder, throwing if message is already known
		const msgFolder = await this.cache.makeNewFolder(msgId);
		
		// write meta to disk
		await this.fs.writeJSONFile(`${msgFolder}/${META_FNAME}`, meta);
		
		// assemble status info object, and save it
		const objs: {
			[objId: string]: { size: ObjSize; partial?: PartialObjInfo; };
		} = {};
		for (const objId of meta.extMeta.objIds) {
			const objStatus = meta.objs[objId];
			if (!objStatus.completed) {
				if (objId === meta.extMeta.objIds[0]) { throw new Error(
					`Main object of message ${msgId} is incomplete, therefore, it cannot be opened.`); }
				throw new Error(`Message ${msgId} has incomplete secondary object, but this implementation cannot handle it, yet`);
			}
			objs[objId] = {
				size: {
					header: objStatus.size.header,
					segments: objStatus.size.segments!
				},
				partial: { headerDone: false, segs: [] }
			};
		}
		const msgStatus: MsgStatus = {
			msgId,
			keyStatus: 'not-checked',
			onDisk: false,
			mainObjId: meta.extMeta.objIds[0],
			deliveryTS: meta.deliveryStart,
			objs
		};
		this.updateMsgStatus(msgId, msgStatus, msgFolder);
	}
	
	async deleteMsg(msgId: string): Promise<void> {
		this.msgStatusCache.delete(msgId);
		await this.cache.removeFolder(msgId);
	}
	
	private async checkObjStatusForUpdate(msgId: string, objId: string):
			Promise<MsgStatus> {
		const msgStatus = await this.findMsg(msgId, true);
		if (msgStatus!.onDisk || !(msgStatus!.objs[objId].partial)) {
			throw new Error('Status indicates object is already on the disk.');
		}
		return msgStatus!;
	}
	
	async saveMsgObjHeader(msgId: string, objId: string, bytes: Uint8Array):
			Promise<void> {
		const msgFolder = await this.cache.getFolder(msgId);

		// check if update operation can be done, else throw
		const msgStatus = await this.checkObjStatusForUpdate(msgId, objId);

		// write header to disk
		await this.fs.writeBytes(
			`${msgFolder}/${objId}${HEADER_FILE_EXT}`, bytes);

		// update message status
		msgStatus.objs[objId].partial!.headerDone = true;
		changeMsgStatusIfObjComplete(msgStatus, objId);
		await this.updateMsgStatus(msgId, msgStatus, msgFolder);
	}
	
	async saveMsgObjSegs(msgId: string, objId: string, offset: number,
			bytes: Uint8Array): Promise<void> {
		const msgFolder = await this.cache.getFolder(msgId);

		// check if update operation can be done, else throw
		const msgStatus = await this.checkObjStatusForUpdate(msgId, objId);

		// write bytes to disk
		const sink = await this.fs.getByteSink(
			`${msgFolder}/${objId}${SEGMENTS_FILE_EXT}`);
		sink.seek!(offset);
		const bytesLen = bytes.length;
		await sink.write(bytes);

		// update message status
		const partial = msgStatus.objs[objId].partial;
		const start = offset;
		const end = offset + bytesLen;
		if (partial) {
			mergeRegions(partial.segs, { start, end });
		} else {
			msgStatus.objs[objId].partial = {
				headerDone: false,
				segs: [ { start, end } ]
			};
		}
		changeMsgStatusIfObjComplete(msgStatus, objId);
		await this.updateMsgStatus(msgId, msgStatus, msgFolder);
	}

	wrap(): InboxCache {
		const w: InboxCache = {
			findMsg: bind(this, this.findMsg),
			updateMsgKeyStatus: bind(this, this.updateMsgKeyStatus),
			getMsgMeta: this.syncAndBind(this.getMsgMeta),
			getMsgObjHeader: this.syncAndBind(this.getMsgObjHeader),
			getMsgObjSegments: this.syncAndBind(this.getMsgObjSegments),
			startSavingMsg: this.syncAndBind(this.startSavingMsg),
			deleteMsg: this.syncAndBind(this.deleteMsg),
			saveMsgObjHeader: this.syncAndBind(this.saveMsgObjHeader),
			saveMsgObjSegs: this.syncAndBind(this.saveMsgObjSegs)
		};
		Object.freeze(w);
		return w;
	}
	
}
Object.freeze(InboxFiles.prototype);
Object.freeze(InboxFiles);

export async function makeInboxCache(cacheFS: WritableFS): Promise<InboxCache> {
	const cache = new InboxFiles(cacheFS);
	await cache.init();
	return cache.wrap();
}

Object.freeze(exports);