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

import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { ByteSource, BytesFIFOBuffer }
	from '../../../lib-common/byte-streaming/common';
import { syncWrapObjSource }
	from '../../../lib-common/obj-streaming/concurrent';
import { ObjFiles, DiffInfo, ObjId, ObjReader } from './files/objs';
import { SyncCompletion } from './obj-procs/sync';
import { Observable, Subscription } from 'rxjs';
import { sleep } from '../../../lib-common/processes';

function addPrecomputedValuesToDiff(diff: DiffInfo): void {
	const sections = diff.sections;
	let totalLen = 0;
	for (let i=0; i<sections.length; i+=1) {
		const sec = sections[i];
		const secLen = sec[2];
		totalLen += secLen;
		sec[3] = totalLen;
	}
	if (diff.segsSize !== totalLen) { throw new Error(`Given object diff clames total segment length as ${diff.segsSize}, while all sectors add up to ${totalLen}`); }
}

class ByteSrc implements ByteSource {

	private segsPointer = 0;
	private baseSrc: ByteSource = (undefined as any);
	
	constructor(
			private objReader: ObjReader,
			private objId: ObjId,
			private version: number,
			private segsSize: number,
			private diff: DiffInfo|undefined) {
		if (this.diff) {
			addPrecomputedValuesToDiff(this.diff);
		}
		Object.seal(this);
	}

	private async getBaseSrc(): Promise<ByteSource> {
		if (!this.baseSrc) {
			throw new Error(`Getting base src is not implemented, yet`);
			// this.baseSrc = (await makeLocalObjSource(this.files,
			// 	this.objId, this.diff!.baseVersion)).segSrc;
		}
		return this.baseSrc;		
	}

	private async getChunk(start, end): Promise<Uint8Array|undefined> {
		const chunk = await this.objReader.readObjSegments(
			this.objId, this.version, start, end);
		if (!chunk) { return undefined; }
		this.segsPointer += chunk.length;
		return chunk;
	}

	private async nonDiffRead(len: number): Promise<Uint8Array|undefined> {
		const start = this.segsPointer;
		const end = ((typeof len === 'number') ? (start + len) : this.segsSize);
		return this.getChunk(start, end);
	}

	private async diffRead(len: number): Promise<Uint8Array|undefined> {
		if (!this.diff) { throw new Error(`Diff is not defined.`); }
		const start = this.segsPointer;
		const end = ((typeof len === 'number') ?
			(start + len) : this.diff.segsSize);

		// find first and last diff sections
		const fstSecInd = this.diff.sections.findIndex(s => (start < s[3]));
		if (typeof fstSecInd !== 'number') { return undefined; }
		let lastSecInd = this.diff.sections.findIndex(s => (end <= s[3]));
		if (typeof lastSecInd !== 'number') {
			lastSecInd = this.diff.sections.length - 1;
		}
		const fstSec = Array.from(this.diff.sections[fstSecInd]);
		const lastSec = ((fstSecInd === lastSecInd) ?
			fstSec : Array.from(this.diff.sections[lastSecInd]));
		
		// adjust position of first sector to align with start
		const fstSecStart = ((fstSecInd === 0) ?
			0 : this.diff.sections[fstSecInd-1][3]);
		fstSec[1] = fstSec[1] + (start - fstSecStart);
		// adjust length of last sector to align with end
		lastSec[2] = lastSec[2] - (lastSec[3] - end);

		const buf = new BytesFIFOBuffer();
		for (let i=fstSecInd; i<=lastSecInd; i+=1) {
			let s: number[];
			if (i === fstSecInd) { s = fstSec; }
			else if (i === lastSecInd) { s = lastSec; }
			else { s = this.diff.sections[i]; }
			if (s[0] === 0) {
				const baseSrc = await this.getBaseSrc();
				baseSrc.seek!(s[1]);
				const bytes = await baseSrc.read(s[2]);
				if (!bytes || (bytes.length < s[2])) { throw new Error(
					`Base file is too short.`); }
				buf.push(bytes);
			} else {
				const bytes = await this.getChunk(s[1], s[1]+s[2]);
				if (!bytes || (bytes.length < s[2])) { throw new Error(
					`Segments file is too short.`); }
				buf.push(bytes);
			}
		}
		return buf.getBytes(undefined);
	}
	
	read(len: number): Promise<Uint8Array|undefined> {
		if ((typeof len === 'number') && len <= 0) { throw new Error(
			'Illegal length parameter given: '+len); }
		if (this.diff) {
			return this.diffRead(len);
		} else {
			return this.nonDiffRead(len);
		}
	}
	
	async getSize(): Promise<number> {
		return (this.diff ? this.diff.segsSize : this.segsSize);
	}
	
	async seek(offset: number): Promise<void> {
		if ((typeof offset !== 'number') || (offset < 0)) { throw new Error(
			'Illegal offset is given to seek: '+offset); }
		this.segsPointer = Math.min(offset, await this.getSize());
	}

	async getPosition(): Promise<number> {
		return this.segsPointer;
	}
}
Object.freeze(ByteSrc.prototype);
Object.freeze(ByteSrc);

class ObjSrc implements ObjSource {
	
	segSrc: ByteSource;
	
	constructor(
			private objReader: LocalAndSyncedObjReader,
			private objId: ObjId,
			public version: number,
			segsSize: number, diff: DiffInfo|undefined) {
		this.segSrc = new ByteSrc(objReader, objId, version, segsSize, diff);
		Object.seal(this);
	}

	readHeader(): Promise<Uint8Array> {
		return this.objReader.readObjHeader(this.objId, this.version);
	}
	
}
Object.freeze(ObjSrc.prototype);
Object.freeze(ObjSrc);

/**
 * This returns a promise, resolvable to source of a given object version.
 * @param objFiles
 * @param syncCompletion$
 * @param objId
 * @param version
 */
export async function makeLocalObjSource(objFiles: ObjFiles,
		syncCompletion$: Observable<SyncCompletion>,
		objId: ObjId, version: number): Promise<ObjSource> {
	const objReader = new LocalAndSyncedObjReader(
		objFiles, syncCompletion$, version);
	const segsSize = await objReader.getSegsSize(objId, version, false);
	const diff = await objReader.readObjDiff(objId, version);
	const src = new ObjSrc(objReader, objId, version, segsSize, diff);
	return Object.freeze(syncWrapObjSource(src));
}

type FileException = web3n.files.FileException;

class LocalAndSyncedObjReader implements ObjReader {

	private syncedVersion: number|undefined = undefined;
	private syncSub: Subscription;

	constructor(
			private objFiles: ObjFiles,
			syncCompletion$: Observable<SyncCompletion>,
			private localVersion: number) {
		this.syncSub = syncCompletion$
		.filter(sc => (sc.localVersion === localVersion))
		.take(1)
		.subscribe(sc => { this.syncedVersion = sc.syncedVersion; });
		Object.seal(this);
	}

	get version(): number {
		return (this.syncedVersion ? this.syncedVersion : this.localVersion);
	}

	private doRead<T>(readOp: (reader: ObjReader, version: number) => Promise<T>,
			secondAttempt = false): Promise<T> {
		let version: number;
		let reader: ObjReader;
		if (this.syncedVersion) {
			version = this.syncedVersion;
			reader = this.objFiles.synced.reader;
		} else {
			version = this.localVersion;
			reader = this.objFiles.local.reader;
		}
		return readOp(reader, version)
		.catch(async (exc: FileException) => {
			// Local version object can be renamed into synced object, at any time.
			// Hence, we may want to try reading operation second time, if rename
			// situation occurs erroring here in a race.
			if (secondAttempt
			|| (reader !== this.objFiles.local.reader)
			|| !exc.notFound) { throw exc; }
			await sleep(10);	// inject time for sync event to surely pass
			return this.doRead(readOp, true);
		});
	}

	getSegsSize(objId: ObjId, v: number, countBase?: boolean) {
		return this.doRead(async (reader, version) =>
			reader.getSegsSize(objId, version, countBase));
	}

	readObjDiff(objId: ObjId, v: number) {
		return this.doRead(async (reader, version) =>
			reader.readObjDiff(objId, version));
	}

	readObjHeader(objId: ObjId, v: number) {
		return this.doRead(async (reader, version) =>
			reader.readObjHeader(objId, version));
	}

	readObjSegments(objId: ObjId, v: number, start: number, end: number) {
		return this.doRead(async (reader, version) =>
			reader.readObjSegments(objId, version, start, end));
	}

	readFirstRawChunk(objId: ObjId, version: number, chunkSize: number) {
		return this.doRead(async (reader, version) =>
			reader.readFirstRawChunk(objId, version, chunkSize));
	}

	readObjInfo(objId: ObjId, version: number) {
		return this.doRead(async (reader, version) =>
			reader.readObjInfo(objId, version));
	}

}
Object.freeze(LocalAndSyncedObjReader.prototype);
Object.freeze(LocalAndSyncedObjReader);

Object.freeze(exports);