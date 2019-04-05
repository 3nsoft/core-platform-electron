/*
 Copyright (C) 2017 3NSoft Inc.
 
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

import { finalize, sleep } from '../../../../lib-common/processes';
import { Subject } from 'rxjs';
import { StorageException } from '../../../../lib-client/3nstorage/exceptions';
import { ConnectException } from '../../../../lib-common/exceptions/http';
import { StorageOwner } from '../../../../lib-client/3nstorage/service';
import { logError } from '../../../../lib-client/logging/log-to-file';
import { LocalObjVersions, ObjId } from '../files/objs';
import { CompleteVersion, Changes, ReturnToQueue, RemoveObjCurrentVersion }
	from './queue';
import { uploadProc } from './upload';
import { readStreamAndFile, ReadingProc }
	from './stream-for-upload';
import { Node } from '../../../../lib-client/3nstorage/xsp-fs/common';

const MAX_CHUNK_SIZE = 512*1024;

export class SyncProc {

	private proc: Promise<void>|undefined = undefined;
	
	constructor(
			private remoteStorage: StorageOwner,
			private objId: ObjId,
			private files: LocalObjVersions,
			private fsNode: () => Node|undefined,
			private returnToQueue: ReturnToQueue) {
		Object.seal(this);
	}

	get chunkSize(): number {
		return (this.remoteStorage.maxChunkSize ?
			Math.min(this.remoteStorage.maxChunkSize, MAX_CHUNK_SIZE) :
			MAX_CHUNK_SIZE);
	}

	get isIdle(): boolean {
		return !this.proc;
	}

	private idleEvents = new Subject<undefined>();

	idle$ = this.idleEvents.asObservable().share();

	/**
	 * This method does two things: it synchronizes actions, and it processes
	 * most generic errors.
	 * @param c 
	 * @param action 
	 */
	private setProc(c: Changes, action: () => Promise<void>): void {
		if (this.proc) { throw new Error(
			'Sync process is already in progress.'); }
		const p = action()
		.catch(async (exc: ConnectException|StorageException) => {
			if (exc.type === 'http-connect') {
				this.returnToQueue(c, true);
			} else if ((exc.type === 'storage') && exc.concurrentTransaction) {
				
				// XXX use for sleep period, provided by server
				await sleep(5000);

				await this.remoteStorage.cancelTransaction(this.objId).catch(noop);
				this.returnToQueue(c);
			} else {
				await logError(exc, `Error occured when uploading change ${c.type} to object ${this.objId}${(c.type !== 'remove-current-version') ? `, version ${c.version}` : '' }`);
			}
		});
		this.proc = finalize(p, () => {
			this.proc = undefined;
			this.idleEvents.next();
		});
	}

	private syncCompletion = new Subject<SyncCompletion>();

	completion$ = this.syncCompletion.asObservable().share();

	completeVersion(c: CompleteVersion): void {
		this.setProc(c, async () => {
			const data = readStreamAndFile(c, this.files.reader,
				this.files.getUploadInfo, this.objId, c.version, this.chunkSize);
			await this.uploadAndResolve(c.version, data);
		});
	}

	private async uploadAndResolve(localVersion: number, data: ReadingProc):
			Promise<void> {
		try {
			await uploadProc(this.remoteStorage, this.files,
				this.objId, localVersion, data);
			await this.files.changeVersionToSynced(this.objId, localVersion);
			const completion: SyncCompletion = {
				syncedVersion: localVersion,
				localVersion
			};
			this.syncCompletion.next(completion);
		} catch (err) {

			if ((err as StorageException).type !== 'storage') { throw err; }

			if ((err as StorageException).versionMismatch) {
				const currentVersion = (err as StorageException).currentVersion!;
				await this.files.indicateConflict(this.objId, currentVersion);
				const fsNode = this.fsNode();
				if (!fsNode) { throw new Error(
					`Missing fs node for object ${this.objId}, while process is active.`); }
				// By awaiting conflict resolution here, we are blocking syncing
				// any other local changes that may be in a pipeline, but that will
				// be invalidated by creation of a new version.
				await fsNode.resolveConflict(currentVersion);
				return;
			}

			if ((err as StorageException).objExists) {
				if (localVersion === 1) {
					throw new Error(
						`Object id collision happened for object ${this.objId}. Code for dealing with this condition is not implemented, yet.`);
				}
			}

			throw err;
		}
	}

	removal(c: RemoveObjCurrentVersion): void {
		this.setProc(c, async () => {
			await this.remoteStorage.deleteObj(this.objId!);
			await this.files.setRemovalAsSynced(this.objId);
		});
	}

}
Object.freeze(SyncProc.prototype);
Object.freeze(SyncProc);

function noop(): void {}

export interface SyncCompletion {
	localVersion: number;
	syncedVersion: number;
}

export type ConflictResolver = (local: web3n.ByteSource,
	remote: web3n.ByteSource) => Promise<web3n.ByteSink>;

Object.freeze(exports);