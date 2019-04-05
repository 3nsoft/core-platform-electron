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

import { Subject, Observable } from 'rxjs';
import { SyncProc } from './sync';
import { ObjId, LocalObjVersions } from '../files/objs';
import { StorageOwner } from '../../../../lib-client/3nstorage/service';
import { ChangeToSync, RemoveObjCurrentVersion, SaveVersion,
	DataChunk }
	from './changes';
import { objChanged, objRemoved }
	from '../../../../lib-common/service-api/3nstorage/owner';
import { bind } from '../../../../lib-common/binding';
import { sleep } from '../../../../lib-common/processes';
import { Node } from '../../../../lib-client/3nstorage/xsp-fs/common';

export { RemoveObjCurrentVersion, DataChunk }
	from './changes';

export type Changes = CompleteVersion | RemoveObjCurrentVersion;

export interface CompleteVersion {
	type: 'save-version',
	version: number,
	data$?: Observable<DataChunk>,
	fileStatus: LocalVersionFileStatus|undefined;
}

export interface LocalVersionFileStatus {
	diff?: number;
	header: number;
	segsTotalLen: number|undefined;
	segs: number;
	doneWritingFile: boolean;
}

const noop = () => {};

function toCompleteVersion(change: SaveVersion): CompleteVersion {
	// add processing inline with data$ to ensure that added here operation does
	// happen before next chained step that may, or may not be chained to data$
	change.data$ = change.data$
	.do(d => {
		const c = change as CompleteVersion;
		if (d.fst) {
			// this is the first data chunk
			c.fileStatus = {
				header: d.fst.header.length,
				segsTotalLen: d.fst.segsLen,
				doneWritingFile: false,
				segs: (d.segs ? d.segs.length : 0)
			}
		}

		if (!c.fileStatus) { throw new Error(
			`Initial data chunk event was missed`); }

		if (!d.fst) {
			// these are subsequent data chunks
			c.fileStatus.segs += (d.segs ? d.segs.length : 0);
		}

		if (d.last) {
			c.fileStatus.doneWritingFile = true;
			c.data$ = undefined;
		}
	});

	// subscribing to ensure that steps in above "do" always happen
	change.data$.subscribe(undefined, noop);
	return change as CompleteVersion;
}

export type ReturnToQueue = (c: Changes, currentlyOffline?: boolean) => void;

export class SyncQueue {

	private buf: Changes[] = [];
	private initFromFileProc: Promise<void>|undefined;
	public sync: SyncProc;
	private currentlyOffline = false;
	
	constructor(
			remoteStorage: StorageOwner,
			private objId: ObjId,
			private files: LocalObjVersions,
			fsNode: () => Node|undefined) {
		this.sync = new SyncProc(remoteStorage, objId, this.files, fsNode,
			bind(this, this.unshiftBuffer));

		// XXX subscriptions in following processes are newer unsubscribe.
		// Is this OK? May be process run as long as program runs.
		this.startProcessingIncomingChanges();
		this.startProcessingBufferBacklog();

		this.initFromFileProc = this.initFromFile();
		Object.seal(this);
	}

	private startProcessingBufferBacklog() {
		this.sync.idle$
		.flatMap(() => this.waitForOnline(), 1)
		.subscribe(() => this.giveNextFromBufToSync());
	}

	get isEmpty(): boolean {
		return (this.buf.length === 0);
	}

	addSyncTask = (change: ChangeToSync) => this.newChanges.next(change);

	private newChanges = new Subject<ChangeToSync>();

	private startProcessingIncomingChanges(): void {
		(this.newChanges.asObservable()
		.flatMap(async c => {
			if (c.type === 'save-version') {
				return toCompleteVersion(c);
			} else {
				return c;
			}
		}, 1) as Observable<Changes>)
		.subscribe(c => {
			if (!c) { return; }
			this.startOrBuf(c);
		});
	}

	private startOrBuf(c: Changes): void {
		if (this.sync.isIdle) {
			this.startSyncing(c);
		} else {
			this.addToBuf(c);
		}
	}

	private giveNextFromBufToSync(): void {
		if (this.initFromFileProc) { return; }
		const c = this.buf.shift();
		if (!c) { return; }
		this.startSyncing(c);
	}

	private addToBuf(c: Changes): void {
		this.buf.push(c);
		if (this.buf.length > 1) {
			this.compressChangesInBuffer();
		}
	}

	// XXX we should move compression from a point of adding, to a point of
	//		sync start, reducing number of calls, may be.
	//		But, when offline, local version will pile up. Hence, may be we'll be
	//		better off by doing compression at the begining, with a possibility to
	//		shift version in fs node.
	private compressChangesInBuffer(): void {

		// XXX compress changes

		// XXX throw on diff version, for now

		// XXX Note that compression will change versions, i.e. local versions
		//		becomes smaller. This versions shift should be properly implemented.
		// Change in version will require header reencryption, cause nonce will be
		//	changed. And this is ok, cause reuse of header's nonce can at most
		// expose segments' nonces, which are random, anyway.

	}

	private startSyncing(c: Changes): void {
		if (c.type === 'save-version') {
			this.sync.completeVersion(c);
		} else if (c.type === 'remove-current-version') {
			this.sync.removal(c);
		} else {
			throw new Error(`Unknown obj change type ${c!.type}`)
		}
	}

	private async initFromFile(): Promise<void> {
		const incomplete = await this.files.getIncompleteSync(this.objId);
		if (incomplete) {
			if (incomplete.unsynced) {
				const localVersions = incomplete.unsynced.localVersions.sort();
				await this.addSyncTasksToBuf(localVersions);
			} else if (incomplete.removal) {
				const c: RemoveObjCurrentVersion = {
					type: 'remove-current-version'
				};
				this.addToBuf(c);
			}
		}
		this.initFromFileProc = undefined;
		this.giveNextFromBufToSync();
	}

	private async addSyncTasksToBuf(localVersions: number[]): Promise<void> {
		for (const v of localVersions) {
			const c = await this.syncTask(v);
			this.buf.push(c);
		}
		this.compressChangesInBuffer();
	}

	private async syncTask(localVersion: number): Promise<CompleteVersion> {
		const { diff, header, segsLen } = await this.files.reader.readObjInfo(
			this.objId, localVersion);
		if (diff) {

			// XXX it should probably be merged with a regular upload, with an
			// addition of diff in passed data
			throw new Error(`Saving diff-ed version is not implemented, yet`);

		} else {
			const c: CompleteVersion = {
				type: 'save-version',
				version: localVersion,
				fileStatus: {
					doneWritingFile: true,
					header: header.length,
					segs: segsLen,
					segsTotalLen: segsLen
				}
			}
			return c;
		}
	}

	async flushAddSyncOf(localVersion: number): Promise<void> {
		const c = await this.syncTask(localVersion);
		this.startOrBuf(c);
	}
	
	private unshiftBuffer(c: Changes, currentlyOffline?: boolean): void {
		this.buf.unshift(c);
		if (currentlyOffline) {
			this.currentlyOffline = true;
		}
	}

	private async waitForOnline(): Promise<void> {
		if (!this.currentlyOffline) { return; }

		// XXX implement a wait for an online event, instead of current sleep
		await sleep(10*1000);

		this.currentlyOffline = false;
	}

	handleRemoteObjChange(objCh: objChanged.Event): void {
		// XXX note that event can be due to this process.
		// Sweep buffer, record info locally, trigger gc

		// XXX put this external change event into a queue, cause it is better
		//		deal with it, with an assurance, that no concurrent syncing happens

	}

	handleRemoteObjRemoval(objRm: objRemoved.Event): void {
		// XXX note that event can be due to this process.
		// Clean buffer, do local removal, trigger gc

	}

}
Object.freeze(SyncQueue.prototype);
Object.freeze(SyncQueue);

Object.freeze(exports);