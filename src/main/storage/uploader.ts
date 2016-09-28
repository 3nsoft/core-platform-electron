/*
 Copyright (C) 2015 - 2016 3NSoft Inc.
 
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
import { StorageOwner as RemoteStorageOwner, TransactionParams }
	from '../../lib-client/3nstorage/service';
import { SyncAction, SyncLog, CacheFiles } from './cache-files';
import { TimeWindowCache } from '../../lib-common/time-window-cache';
import { makeCachedObjSource } from './cached-obj-source';
import { ByteSource } from '../../lib-common/byte-streaming/common';

let MAX_CHUNK_SIZE = 512*1024;

interface SequentialUploadProgress {
	transactionId?: string;
	headerSynced?: boolean;
	segBytesSynced: number;
}

export class Uploader {
	
	private logProcs = new NamedProcs();
	private uploadProcs = new NamedProcs();
	
	constructor(
			private files: CacheFiles,
			private logsCache: TimeWindowCache<string, SyncLog>,
			private remoteStorage: RemoteStorageOwner) {
		Object.seal(this);
	}

	private async logFor(objId: string): Promise<SyncLog> {
		let log = this.logsCache.get(objId);
		if (log) { return log; }
		return this.files.syncLogFor(objId);
	}

	private async updateLog(objId: string,
			update: (log: SyncLog) => SyncLog): Promise<void> {
		return this.logProcs.startOrChain(objId, async () => {
			let log = await this.logFor(objId);
			log = update(log);
			await this.files.setSyncLog(objId, log);
		});
	}

	/**
	 * @param objId
	 * @param act
	 * @return a promise, resolvable to intention number, with which given action
	 * is recorded.
	 */
	async recordIntendedAction(objId: string, act: SyncAction): Promise<number> {
		await this.updateLog(objId, (log) => {
			if (!log) { log = { objId, counter: 0, backlog: [] }; }
			log.counter += 1;
			act.intentionNum = log.counter;
			log.backlog.push(act);
			return log;
		});
		return act.intentionNum;
	}

	async activateSyncAction(objId: string, actNum: number): Promise<void> {
		await this.updateLog(objId, (log) => {
			if (!log) { throw new Error(
				`Sync log is missing for object ${objId}`); }
			for (let action of log.backlog) {
				if (action.intentionNum === actNum) {
					delete action.intentionNum;
					break;
				}
			}
			return log;
		});
		this.startSync(objId);
	}

	private startSync(objId: string, recursiveStart = false): void {
		this.logProcs.startOrChain(objId, async () => {
			if (!recursiveStart && this.uploadProcs.getP(objId)) { return; }
			let log = await this.logFor(objId);
			let action: SyncAction;
			if (log.currentAction) {
				action = log.currentAction;
			} else if (log.backlog.length > 0) {
				if (typeof log.backlog[0].intentionNum === 'number') { return; }
				action = log.backlog.shift();
			} else {
				await this.files.clearSyncLog(objId);
				this.files.garbageCollect(objId);
				return;
			}
			log.currentAction = action;
			await this.files.setSyncLog(objId, log);
			if (action.completeUpload) {
				this.uploadProcs.addStarted(objId, this.doCompleteUpload(
					objId, action.version, log.progress));
			} else if (action.deleteObj) {
				this.uploadProcs.addStarted(objId, this.doDeleteObj(objId));
			} else if (action.deleteArchivedVersion) {
				this.uploadProcs.addStarted(objId, this.doDeleteArchived(
					objId, action.version));
			} else {
				throw `Have unknown action: ${JSON.stringify(action)}`;
			}
		});
	}
	
	private async logProgress<T>(objId: string, actionProgress: T):
			Promise<void> {
		await this.updateLog(objId, (log) => {
			if (!log) { throw new Error(
				`Sync log is missing for object ${objId}`); }
			log.progress = actionProgress;
			return log;
		});
	}

	private async completeCurrentAction(objId: string): Promise<void> {
		await this.updateLog(objId, (log) => {
			log.progress = null;
			log.currentAction = null;
			return log;
		});
	}

	/**
	 * This sends header, logging the progress.
	 */
	private async sendHeader(objId: string, version: number,
			progress: SequentialUploadProgress, header: Uint8Array):
			Promise<void> {
		await this.remoteStorage.saveObjHeader(
			objId, progress.transactionId, header);
		progress.headerSynced = true;
		await this.logProgress(objId, progress);
	}

	/**
	 * This sends segments in a non-appending mode, logging the progress.
	 */
	private async sendSegments(objId: string, version: number,
			progress: SequentialUploadProgress): Promise<void> {
		let chunkSize = Math.min(
			this.remoteStorage.maxChunkSize, MAX_CHUNK_SIZE);
		let offset = progress.segBytesSynced;
		let chunk = await this.files.readObjSegments(objId, version,
			offset, offset+chunkSize);
		while (chunk.length > 0) {
			await this.remoteStorage.saveObjSegs(objId, progress.transactionId,
				offset, chunk);
			offset += chunk.length;
			progress.segBytesSynced = offset;
			await this.logProgress(objId, progress);
			chunk = await this.files.readObjSegments(objId, version,
				offset, offset+chunkSize);
		}
	}

	private async doCompleteUpload(objId: string, version: number,
			progress: SequentialUploadProgress): Promise<void> {
		if (!this.remoteStorage.isSet()) { return; }

		let header: Uint8Array;

		if (!progress) {
			header = await this.files.readObjHeader(objId, version);
			let diff = await this.files.readObjDiff(objId, version);
			let segsSize = await this.files.getSegsSize(objId, version, false);

			// start a remote transaction
			let transParams: TransactionParams = {
				version,
				sizes: {
					header: header.length,
					segments: segsSize
				}
			};
			if (diff) {
				transParams.diff = diff;
			} else if (version === 1) {
				transParams.isNewObj = true;
			}
			let trans = await this.remoteStorage.startTransaction(
				objId, transParams);
			
			// record progress with transaction id
			progress = {
				transactionId: trans.transactionId,
				headerSynced: false,
				segBytesSynced: 0
			};
			await this.logProgress(objId, progress);
		}

		try {
			// upload all bytes
			if (!progress.headerSynced) {
				if (!header) {
					header = await this.files.readObjHeader(objId, version);
				}
				await this.sendHeader(objId, version, progress, header);
			}
			await this.sendSegments(objId, version, progress);

			// complete remote transaction
			await this.remoteStorage.completeTransaction(
				objId, progress.transactionId);
			await this.completeCurrentAction(objId);
		} catch (exc) {

			// TODO depending on exception, do different setting of progress
			//		allowing continuation of an upload, when transaction is still
			//		valid.

			await this.remoteStorage.cancelTransaction(
				objId, progress.transactionId).catch(() => {});
			await this.logProgress(objId, null);
			throw exc;
		}
		
		// continue to the next action, or do recursion in this
		this.startSync(objId, true);
	}
	
	private async doDeleteObj(objId: string): Promise<void> {
		if (!this.remoteStorage.isSet()) { return; }

		// remote call to delete object (archived versions stay intact)
		await this.remoteStorage.deleteObj(objId);
		await this.completeCurrentAction(objId);
	
		// continue to next action
		this.startSync(objId, true);
	}
	
	private async doDeleteArchived(objId: string, version: number):
			Promise<void> {
		if (!this.remoteStorage.isSet()) { return; }

		// XXX implement and do proper server call
		console.warn('Deleting archived version on the server is not implemented, yet.');

		await this.completeCurrentAction(objId);
	
		// continue to next action
		this.startSync(objId, true);
	}

}
Object.freeze(Uploader.prototype);
Object.freeze(Uploader);

Object.freeze(exports);