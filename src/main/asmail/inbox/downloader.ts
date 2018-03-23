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

import { NamedProcs } from '../../../lib-common/processes';
import { MailRecipient } from '../../../lib-client/asmail/recipient';
import { InboxCache, PartialObjInfo, ObjSize, MsgStatus, MsgMeta }
	from './cache';
import { splitBigRegions, missingRegionsIn, Region }
	from '../../../lib-client/local-files/regions';

const MAX_GETTING_CHUNK = 512*1024;
const DOWNLOAD_START_CHUNK = 128*1024;

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
		const pid = procId(msgId, undefined);
		return this.downloadProcs.startOrChain(pid, async () => {
			// protect from a duplicate action
			let msgStatus = await this.cache.findMsg(msgId);
			if (msgStatus) { return msgStatus; }

			// download message meta
			const meta = await this.msgReceiver.getMsgMeta(msgId);

			// cache meta
			await this.cache.startSavingMsg(msgId, meta);

			// return new message status
			msgStatus = (await this.cache.findMsg(msgId, true))!;
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
		const msgStatus = (await this.cache.findMsg(msgId, true))!;
		const objInfo = msgStatus.objs[objId];
		if (!objInfo) { throw new Error(
			`Cannot find object ${objId} in message ${msgId}`); }
		const onDisk = !objInfo.partial;

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
		const { onDisk } = await this.statusOf(msgId, objId);
		if (onDisk) { return true; }
		return this.downloadProcs.startOrChain(objId, async () => {
			// protect from a duplicate action
			let { onDisk, partial } = await this.statusOf(msgId, objId);
			if (onDisk || partial!.headerDone) { return true; }

			// download header and first segments chunk
			const { header, segsChunk } =
				await this.msgReceiver.getObj(msgId, objId, DOWNLOAD_START_CHUNK);

			// save bytes to cache
			await this.cache.saveMsgObjHeader(msgId, objId, header);
			if (segsChunk.length > 0) {
				await this.cache.saveMsgObjSegs(msgId, objId, 0, segsChunk);
			}

			// return new status
			({ onDisk } = await this.statusOf(msgId, objId));
			return onDisk;
		});
	}

	/**
	 * This returns a promise of a boolean flag, which is true, when all bytes
	 * are cached, and false, otherwise. Even when false is returned, when
	 * promise is resolved, it is ensured that a segment between given start and
	 * end is on the disk, i.e. this method ensures that segment is available.
	 * @param msgId
	 * @param objId
	 * @param start
	 * @param end
	 */
	async ensureSegsAreOnDisk(msgId: string, objId: string,
			start: number, end: number): Promise<boolean> {
		const { onDisk } = await this.statusOf(msgId, objId);
		if (onDisk) { return true; }
		return this.downloadProcs.startOrChain(objId, async () => {
			// protect from a duplicate action
			let { onDisk, partial, size } = await this.statusOf(msgId, objId);
			if (onDisk) { return true; }

			// find missing regions between start and end
			let regionsToGet = missingRegionsIn(start, end, partial!.segs);
			if (regionsToGet.length === 0) { return onDisk; }

			// adjust end parameter to guard against tiny network request
			if ((end - start) < MAX_GETTING_CHUNK) {
				end = Math.min(start + MAX_GETTING_CHUNK, size!.segments);
				regionsToGet = missingRegionsIn(start, end, partial!.segs);
			}

			// download missing segments
			if (regionsToGet.length > 0) {
				splitBigRegions(regionsToGet, MAX_GETTING_CHUNK);
				for (const r of regionsToGet) {
					const chunk = await this.msgReceiver.getObjSegs(msgId, objId,
						r.start, r.end);
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