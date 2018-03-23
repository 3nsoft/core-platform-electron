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

import { Observable, Subscription } from 'rxjs';
import { StorageOwner as RemoteStorageOwner }
	from '../../../../lib-client/3nstorage/service';
import { ObjFiles, ObjId } from '../files/objs';
import { ChangesProc } from './changes';
import { SyncQueue } from './queue';
import { SyncCompletion } from './sync';
import { objChanged, objRemoved }
	from '../../../../lib-common/service-api/3nstorage/owner';
import { TimeWindowCache } from '../../../../lib-common/time-window-cache';
import { logError } from '../../../../lib-client/logging/log-to-file';
import { Node } from '../../../../lib-client/3nstorage/xsp-fs/common';
import { ObjSource } from '../../../../lib-common/obj-streaming/common';


// Rule #1: All conflicts are resolved locally, on a device that has a conflict.

// Rule #2: new version event will come to fs watcher after conflict resolution,
//				done either by default function, or by provided function.

// Rule #3: automatic conflict resolution should not be attempted, when noone is
//				using an object (file/folder). It can only be attempted when an app
//				touches an object, either by watching changes, or by starting to
//				write to it. I.e. there should be a point of sync process start,
//				before writing new version and listening to changes. There will also
//				be a point of sync process stop, after which cache may record info
//				about server latest versions, but nothing else be done.

// Rule #4: default conflict resolution rule is remote storage's behaviour,
//				which is: new local version is written on top of new remote version,
//				i.e. the last version

// Rule #5: to process conflict, local write should be absorbed first,
//				processed, and pushed as a new version to local consumer and
//				uploaded to server. In other words, there should be no
//				exceptions thrown when writing (absorbing) of a new local version.

// Rule #6: New local version will have to be conflict resolved anyway. The
//				question is about possibility of pile up on local write: like with
//				stack overflow, throw when there is too many outstanding local
//				writes.

// Rule #7: proc should complete conflict resolution, and only after set new
//				version in fs node. This will allow to detect a local write that,
//				by virtue of version mismatch, will be seen as conflicting.


//  In FS api, we should use word "sync", when we start active sync-ing, give
//		conflict resolving function.
//		Watching should keep the same meaning as everywhere else. Should an event
//		of conflict-resolved record be labeled as remote? Should we have two
//		flags, resolved and remote, so as to allow code that looks for remote,
//		like elsewhere, and to allow conflict info be present, just in case.

export class ObjProc {

	change: ChangesProc;
	private syncQueue: SyncQueue;
	syncCompletion$: Observable<SyncCompletion>;
	
	constructor(remoteStorage: RemoteStorageOwner, objId: ObjId, files: ObjFiles,
			fsNode: () => Node|undefined) {
		this.syncQueue = new SyncQueue(remoteStorage, objId, files.local, fsNode);
		this.syncCompletion$ = this.syncQueue.sync.completion$;
		this.change = new ChangesProc(objId,
			this.syncQueue.addSyncTask,
			() => this.syncQueue.sync.chunkSize,
			files);
		Object.seal(this);
	}

	handleRemoteObjChange(objCh: objChanged.Event): void {
		this.syncQueue.handleRemoteObjChange(objCh);
	}

	handleRemoteObjRemoval(objRm: objRemoved.Event): void {
		this.syncQueue.handleRemoteObjRemoval(objRm);
	}

	get isIdle(): boolean {
		return (this.change.isIdle &&
			this.syncQueue.sync.isIdle && this.syncQueue.isEmpty);
	}

	startUploadFrom(localVer: number): Promise<void> {
		return this.syncQueue.flushAddSyncOf(localVer);
	}

}
Object.freeze(ObjProc.prototype);
Object.freeze(ObjProc);

const PROC_TIMEOUT_MILLIS = 3*60*1000;

export class ObjProcs {

	procs = new TimeWindowCache<ObjId, ObjProc>(
		PROC_TIMEOUT_MILLIS, p => p.isIdle);

	constructor(
			private remoteStorage: RemoteStorageOwner,
			private files: ObjFiles,
			private fsNodes: (objId: ObjId) => Node|undefined) {
		Object.seal(this);
	}

	private startingUnsyncedProc: Subscription|undefined = undefined;

	startSyncOfFilesInCache(): void {
		if (this.startingUnsyncedProc) { return; }
		this.startingUnsyncedProc = this.files.collectUnsyncedObjs()
		// implicitly start incomplete uploads, when creating respective procs
		.map(objId => this.getOrMakeObjProc(objId))
		.catch(err => logError(err, `Error in starting unsynced objs' processes`))
		.subscribe(undefined, undefined, () => {
			this.startingUnsyncedProc = undefined;
		});
	}

	getOpened(objId: ObjId): ObjProc|undefined {
		return this.procs.get(objId);
	}

	getOrMakeObjProc(objId: ObjId): ObjProc {
		let p = this.procs.get(objId);
		if (p) { return p; }
		const fsNode = () => this.fsNodes(objId);
		p = new ObjProc(this.remoteStorage, objId, this.files, fsNode);
		this.procs.set(objId, p);
		return p;
	}

	delete(objId: ObjId): void {
		this.procs.delete(objId);
	}

	async close(): Promise<void> {
		if (this.startingUnsyncedProc) {
			this.startingUnsyncedProc.unsubscribe();
		}
		
		// XXX ensure that processes cannot be started, cancel existing, wait all

	}

}

export type ConflictResolver = (local: web3n.ByteSource,
	remote: web3n.ByteSource) => Promise<web3n.ByteSource>;

Object.freeze(exports);