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

import { NamedProcs } from '../../lib-common/processes';
import { MailRecipient } from '../../lib-client/asmail/recipient';
import { InboxCache, PartialObjInfo, ObjSize, MsgStatus, MsgMeta }
	from './inbox-cache';
import { splitBigRegions, missingRegionsIn, Region }
	from '../../lib-client/local-files/regions';

let MAX_GETTING_CHUNK = 512*1024;

function procId(msgId: string, objId: string|undefined): string {
	if (objId === undefined) {
		return msgId;
	} else {
		return `${msgId}/${objId}`;
	}
}

/**
 * Downloader is responsible for getting mail objects from server and placing
 * bytes into cache.
 */
export class Downloader {

	/**
	 * Per-object chained downloads.
	 * When it comes to the download start, if chain exists, it means that
	 * process has already started.
	 */
	private downloadProcs = new NamedProcs();

	constructor(
			private cache: InboxCache,
			private msgReceiver: MailRecipient) {
		Object.seal(this);
	}
	
	/**
	 * @param msgId
	 * @return a promise, resolvable to message status, when first part(s) of the
	 * message are downloaded and saved  to cache.
	 */
	startMsgDownload(msgId: string): Promise<MsgStatus> {
		let pid = procId(msgId, undefined);
		return this.downloadProcs.startOrChain(pid, async () => {
			// protect from a duplicate action
			let msgStatus = await this.cache.findMsg(msgId);
			if (msgStatus) { return msgStatus; }

			// download message meta
			let meta = await this.msgReceiver.getMsgMeta(msgId);

			// cache meta
			await this.cache.startSavingMsg(msgId, meta);

			// return new message status
			msgStatus = await this.cache.findMsg(msgId, true);
			return msgStatus;
		});
	}

	/**
	 * @param msgId
	 * @param objId
	 * @return a promise resolvable to an info about an object, telling if it is
	 * on the disk already, giving object's size, and providing a partial
	 * download info, if the object is not completely on the disk. 
	 */
	async statusOf(msgId: string, objId: string):
			Promise<{ onDisk: boolean; size: ObjSize;
				partial?: PartialObjInfo; }> {
		let msgStatus = (await this.cache.findMsg(msgId, true))!;
		let objInfo = msgStatus.objs[objId];
		if (!objInfo) { throw new Error(
			`Cannot find object ${objId} in message ${msgId}`); }
		let onDisk = !objInfo.partial;

		if (onDisk) {
			return { onDisk, size: objInfo.size };
		} else {
			return {
				onDisk,
				size: objInfo.size,
				partial: objInfo.partial
			};
		}
	}

	/**
	 * @param msgId
	 * @param objId
	 * @param start
	 * @param end
	 * @return true, when all bytes are cached, and false, otherwise.
	 */
	async ensureHeaderIsOnDisk(msgId: string, objId: string):
			Promise<boolean> {
		let { onDisk } = await this.statusOf(msgId, objId);
		if (onDisk) { return true; }
		return this.downloadProcs.startOrChain(objId, async () => {
			// protect from a duplicate action
			let { onDisk, partial } = await this.statusOf(msgId, objId);
			if (onDisk || partial!.headerDone) { return true; }

			// download header
			let h = await this.msgReceiver.getObjHead(msgId, objId);

			// save header to cache
			await this.cache.saveMsgObjHeader(msgId, objId, h);

			// return new status
			({ onDisk } = await this.statusOf(msgId, objId));
			return onDisk;
		});
	}

	/**
	 * @param msgId
	 * @param objId
	 * @param start
	 * @param end
	 * @return true, when all bytes are cached, and false, otherwise.
	 */
	async ensureSegsAreOnDisk(msgId: string, objId: string,
			start: number, end: number): Promise<boolean> {
		let { onDisk } = await this.statusOf(msgId, objId);
		if (onDisk) { return true; }
		return this.downloadProcs.startOrChain(objId, async () => {
			// protect from a duplicate action
			let { onDisk, partial, size } = await this.statusOf(msgId, objId);
			if (onDisk) { return true; }

			// adjust end parameter to guard against tiny network request
			if ((end - start) < MAX_GETTING_CHUNK) {
				end = start + Math.min(MAX_GETTING_CHUNK, size!.segments);
			}

			// find missing segments regions
			let regionsToGet = missingRegionsIn(start, end, partial!.segs);

			// download missing segments
			if (regionsToGet.length > 0) {
				splitBigRegions(regionsToGet, MAX_GETTING_CHUNK);
				for (let r of regionsToGet) {
					let chunk = await this.msgReceiver.getObjSegs(msgId, objId,
						{ ofs: r.start, len: (r.end - r.start) });
					await this.cache.saveMsgObjSegs(msgId, objId, r.start, chunk);
				}
				({ onDisk } = await this.statusOf(msgId, objId));
			}

			return onDisk;
		});
	}
	
}
Object.freeze(Downloader.prototype);
Object.freeze(Downloader);

Object.freeze(exports);