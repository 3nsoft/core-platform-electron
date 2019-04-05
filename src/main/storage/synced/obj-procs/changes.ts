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

import { ObjSource } from '../../../../lib-common/obj-streaming/common';
import { SingleProc } from '../../../../lib-common/processes';
import { Subject, Observable } from 'rxjs';
import { ObjFiles, ObjId } from '../files/objs';

export type ChangeToSync = SaveVersion | RemoveObjCurrentVersion;

export interface SaveVersion {
	type: 'save-version';
	version: number;
	data$: Observable<DataChunk>;
}

export interface RemoveObjCurrentVersion {
	type: 'remove-current-version';
}

export interface DataChunk {
	fst?: {
		diffBytes?: Uint8Array;
		header: Uint8Array;
		segsLen?: number;
	};
	segs: Uint8Array|undefined;
	segsOfs: number;
	last: boolean;
}

/**
 * Instance of this class absorbs changes to object that come from this
 * local side. Changes will be recorded locally, as well as given to sync
 * process to upload onto server.
 */
export class ChangesProc {

	private procQueue = new SingleProc();
	constructor(
			private objId: ObjId,
			private queueForSync: (change: ChangeToSync) => void,
			private chunkSize: () => number,
			private files: ObjFiles) {
		Object.seal(this);
	}

	get isIdle(): boolean {
		return !this.procQueue.getP();
	}

	async saveObj(src: ObjSource): Promise<void> {
		await this.procQueue.startOrChain(() => {
			const version = src.version;
			const dataForUpload = new Subject<DataChunk>();
			this.queueForSync({
				type: 'save-version',
				version,
				data$: dataForUpload.asObservable()
			});

			const reading = readingProc(src, this.chunkSize());
			
			const saving = reading.data$
			.flatMap(async d => {
				if (d.fst) {
					await this.files.local.startSaving(this.objId, version,
						undefined, d.fst.header, d.segs, d.last);
				} else {
					await this.files.local.continueSaving(this.objId, version,
						d.segs, d.last);
				}
				return d;
			}, 1)
			.do(d => dataForUpload.next(d),
				err => dataForUpload.error(err),
				() => dataForUpload.complete())
			.map(() => reading.readNext())
			.toPromise();

			// 1) Should trigger reading after implicit subscription in toPromise()
			// 2) Trigger reading twice, so that when first chunk is being saved,
			// the second one is prepared. Note that an extra trigger is a noop.
			reading.readNext();
			reading.readNext();
			
			return saving;
		});
	}

	removeObj(): Promise<void> {
		return this.procQueue.startOrChain(async () => {
			if (!this.objId) { throw new Error(`Cannot remove root object.`); }
			await this.files.local.removeCurrentObjVersion(this.objId);
			this.queueForSync({ type: 'remove-current-version' });
		});
	}

}
Object.freeze(ChangesProc.prototype);
Object.freeze(ChangesProc);

interface ReadingProc {
	data$: Observable<DataChunk>;
	readNext(): void;
}

export function readingProc(src: ObjSource, chunkSize: number): ReadingProc {
	const canReadBytes = new Subject<void>();
	let isFirstRead = true;
	let segBytesRead = 0;
	let segsOfs = segBytesRead;
	let segsLen: number|undefined = undefined;
	let done = false;

	const data$: Observable<DataChunk> = canReadBytes.asObservable()
	.flatMap(async () => {
		if (done) { return; }
		let d: DataChunk;
		if (isFirstRead) {
			isFirstRead = false;
			const header = await src.readHeader();
			const fstMaxChunk = chunkSize - header.length;
			const segs = await src.segSrc.read(fstMaxChunk);
			if (segs) {
				segBytesRead += segs.length;
			}
			segsLen = await src.segSrc.getSize();
			done = ((typeof segsLen === 'number') ?
				(segBytesRead >= segsLen) :
				(segBytesRead < fstMaxChunk));
			d = { fst: { header, segsLen }, segs, last: done, segsOfs };
		} else {
			const segs = await src.segSrc.read(chunkSize);
			if (segs) {
				segBytesRead += segs.length;
			}
			done = ((typeof segsLen === 'number') ?
				(segBytesRead >= segsLen) :
				(segBytesRead < chunkSize));
			if (!segs && !done) {
				throw new Error('Getting no segments. Is it a broken object stream?');
			}
			d = { segs, last: done, segsOfs };
		}
		if (done) { canReadBytes.complete(); }
		segsOfs = segBytesRead;
		return d;
	}, 1)
	.filter(d => !!d) as Observable<DataChunk>;

	return {
		data$,
		readNext: () => canReadBytes.next()
	};
}

Object.freeze(exports);