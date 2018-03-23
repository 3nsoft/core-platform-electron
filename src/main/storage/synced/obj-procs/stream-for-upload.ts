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
import { ObjId, ObjReader } from '../files/objs';
import { utf8 } from '../../../../lib-common/buffer-utils';
import { CompleteVersion, LocalVersionFileStatus } from './queue';
import { UploadInfo } from '../files/local-versions'

export interface ReadingProc {
	chunk$: Observable<FileChunk>;
	readNext(): void;
}

export interface FileChunk {
	fst?: {
		diff?: number;
		header: number;
		segsLen?: number;
	};
	transactionId?: string;
	segsOfs: number;
	segs: number;
	bytes: Uint8Array|Uint8Array[];
	last: boolean;
}

const EMPTY_BYTE_ARR = new Uint8Array(0);

interface ReadInstruction {
	fst?: {
		diff?: number;
		header: number;
		segsLen?: number;
	}
	segsOfs: number;
	segs: number;
	last: boolean;
	bytes?: Uint8Array|Uint8Array[];
}

type UploadInfoGetter =
	(objId: ObjId, version: number) => Promise<UploadInfo|undefined>;

export function readStreamAndFile(change: CompleteVersion, reader: ObjReader,
		readUploadProgressFile: UploadInfoGetter,
		objId: ObjId, version: number, chunkSize: number): ReadingProc {
	if (!change.fileStatus && !change.data$) { throw new Error(
		`Both file status and data streams a missing in change info.`); }
	
	let isFirstRead = true;
	let incompleteRI: ReadInstruction|undefined = undefined;
	let readyReads: ReadInstruction[] = [];

	if (change.fileStatus) {
		({ complete: readyReads, incomplete: incompleteRI } =
			fileStatusToReadInstructions(change.fileStatus, chunkSize));
	} else {
		readUploadProgressFile = (undefined as any);
	}
	
	const readyRead$ = (!change.data$ ? undefined : change.data$
	.map(d => {
		let ri = incompleteRI;

		if (isFirstRead && d.fst) {
			if (ri) { throw new Error(`Unexpected state.`); }
			const bytes = [ d.fst.header ];
			if (d.fst.diffBytes) {
				bytes.unshift(d.fst.diffBytes);
			}
			if (d.segs) {
				bytes.push(d.segs);
			}
			ri = {
				fst: {
					diff: (d.fst.diffBytes ? d.fst.diffBytes.length : undefined),
					header: d.fst.header.length,
					segsLen: d.fst.segsLen
				},
				last: d.last,
				segs: (d.segs ? d.segs.length : 0),
				segsOfs: 0,
				bytes
			};
		} else {
			if (d.fst) { throw new Error(`Unexpected state.`); }
			if (ri) {
				if (d.segs) {
					if (Array.isArray(ri.bytes)) {
						ri.bytes.push(d.segs);
					} else {
						ri.bytes = [ ri.bytes!, d.segs ];
					}
					ri.segs += d.segs.length;
				}
				ri.last = d.last;
			} else {
				if (isFirstRead) { throw new Error(`Unexpected state.`); }
				ri = {
					segsOfs: d.segsOfs,
					segs: (d.segs ? d.segs.length : 0),
					bytes: [ (d.segs ? d.segs : EMPTY_BYTE_ARR) ],
					last: d.last
				};
			}
		}

		const { complete, incomplete } = splitReadInstruction(ri, chunkSize);
		incompleteRI = incomplete;
		if (complete.length > 0) {
			isFirstRead = false;
		}
		return complete;
	})
	.filter(ris => (ris.length > 0))
	.map(ris => {
		const backlog = readyReads.push(...ris);
		if (backlog > 2) {
			for (const ri of ris) { ri.bytes = undefined; }
		}
	})
	.share());

	if (readyRead$) {
		// turn on processing of incoming data$ into readyReads buffer
		readyRead$.subscribe(undefined, noop);
	}

	return readWithInstructions(readyReads, readyRead$,
		reader, readUploadProgressFile, objId, version);
}

function fileStatusToReadInstructions(status: LocalVersionFileStatus,
		chunkSize: number):
		{ complete: ReadInstruction[]; incomplete?: ReadInstruction; } {
	const complete: ReadInstruction[] = [];
	let incomplete: ReadInstruction|undefined = undefined;
	let isFst = true;
	let segsLeft = status.segs;
	let segsOfs = 0;

	do {
		let ri: ReadInstruction;
		if (isFst) {
			isFst = false;
			const nonSegs = status.header + (status.diff ? status.diff : 0);
			if (nonSegs > chunkSize) { throw new Error(
				`Read chunk length ${chunkSize} is less than ${nonSegs}, which is length of a header and a diff.`); }
			ri = {
				fst: {
					diff: status.diff,
					header: status.header,
					segsLen: status.segsTotalLen
				},
				segsOfs,
				segs: Math.min(segsLeft, chunkSize - nonSegs),
				last: false
			};
		} else {
			ri = {
				segsOfs,
				segs: Math.min(segsLeft, chunkSize),
				last: false
			};
		}
		segsOfs += ri.segs;
		segsLeft -= ri.segs;
		if (ri.segs > (0.8 * chunkSize)) {
			complete.push(ri);
		} else {
			incomplete = ri;
		}
	} while (segsLeft > 0);

	if (status.doneWritingFile) {
		if (incomplete) {
			complete.push(incomplete);
			incomplete = undefined;
		}
		complete[complete.length-1].last = true;
	}

	return { complete, incomplete };
}

function noop(): void {}

function totalLength(bytes: Uint8Array|Uint8Array[]): number {
	if (!Array.isArray(bytes)) { return bytes.length; }
	let totalLen = 0;
	for (const arr of bytes) {
		totalLen += arr.length;
	}
	return totalLen;
}

function splitReadInstruction(ri: ReadInstruction, chunkSize: number):
		{ complete: ReadInstruction[]; incomplete?: ReadInstruction; } {
	const complete: ReadInstruction[] = [];
	let bytesLen = totalLength(ri.bytes!);
	while (bytesLen > chunkSize) {
		const c = {} as ReadInstruction;
		const nonSegs = (!ri.fst ? 0 :
			ri.fst.header + (ri.fst.diff ? ri.fst.diff : 0));
		if (ri.fst) {
			c.fst = ri.fst;
			ri.fst = undefined;
			if (nonSegs > chunkSize) { throw new Error(
				`Read chunk length ${chunkSize} is less than ${nonSegs}, which is length of a header and a diff.`); }
		}
		const initLen = bytesLen;
		([ c.bytes, ri.bytes ] = splitFirstBytesFrom(ri.bytes!, chunkSize));
		bytesLen = totalLength(ri.bytes!);
		c.segsOfs = ri.segsOfs;
		c.segs = initLen - bytesLen - nonSegs;
		ri.segsOfs += c.segs;
		ri.segs = bytesLen;
		complete.push(c);
	}
	if (ri.last || (bytesLen > (0.8 * chunkSize))) {
		complete.push(ri);
		return { complete };
	} else {
		return { complete, incomplete: ri };
	}
}

function splitFirstBytesFrom(bytes: Uint8Array|Uint8Array[], chunkSize: number):
		(Uint8Array|Uint8Array[])[] {
	if (!Array.isArray(bytes)) {
		return [ bytes.subarray(0, chunkSize), bytes.subarray(chunkSize) ];
	}
	let bytesNeeded = chunkSize;
	const fst: Uint8Array[] = [];
	while (bytesNeeded > 0) {
		const b = bytes[0];
		if (b.length > bytesNeeded) {
			fst.push(b.subarray(0, bytesNeeded));
			bytes[0] = b.subarray(bytesNeeded);
			break;
		}
		fst.push(b);
		bytes.shift();
		bytesNeeded -= b.length;
	}
	return [ fst, bytes ];
}

function readWithInstructions(readyReads: ReadInstruction[],
		readyRead$: Observable<void>|undefined, reader: ObjReader,
		readUploadProgressFile: UploadInfoGetter|undefined,
		objId: ObjId, version: number): ReadingProc {

	const canReadBytes = new Subject<void>();
	let done = false;
	
	const chunk$: Observable<FileChunk> = canReadBytes.asObservable()
	.flatMap(async () => {
		if (done) { return; }

		let transactionId: string|undefined = undefined;
		if (readUploadProgressFile) {
			const priorUpload = await readUploadProgressFile(objId, version);
			readUploadProgressFile = (undefined as any);
			if (priorUpload) {
				if (priorUpload.done) { throw new Error(
					`Upload of version ${version} object ${objId} has already been done, according to `); }
				removeReadsWithUploadedBytes(readyReads, priorUpload);
				transactionId = priorUpload.transactionId!;
			}
		}

		let ri = readyReads.shift();
		if (!ri) {
			if (!readyRead$) { throw new Error(
				`Last read must've failed to set done flag`); }
			await readyRead$.take(1).toPromise();
			ri = readyReads.shift();
			if (!ri) { throw new Error(
				`Last read is either missing, or it failed to set done flag`); }
		}

		let d: FileChunk;
		if (ri.fst) {
			let bytes = ri.bytes;
			if (!bytes) {
				const rawLen = 8 + ri.fst.header + ri.segs +
					(ri.fst.diff ? (5 + ri.fst.diff) : 0);
				({ chunk: bytes } = await reader.readFirstRawChunk(
					objId, version, rawLen));
			}
			d = {
				fst: ri.fst,
				bytes,
				last: ri.last,
				segs: totalLength(bytes) - ri.fst.header -
					(ri.fst.diff ? ri.fst.diff : 0),
				segsOfs: 0
			};
		} else {
			let bytes = ri.bytes;
			if (!bytes) {
				bytes = ((ri.segs < 1) ? EMPTY_BYTE_ARR :
					await reader.readObjSegments(objId, version,
						ri.segsOfs, ri.segsOfs + ri.segs));
				if (!bytes) { throw new Error(`Getting no segments. Is it a broken local file for object ${objId}, version ${version}?`); }
			}
			d = {
				bytes,
				last: ri.last,
				segs: totalLength(bytes),
				segsOfs: ri.segsOfs,
				transactionId
			};
		}
		done = d.last;
		if (done) { canReadBytes.complete(); }
		return d;
	}, 1)
	.filter(d => !!d) as Observable<FileChunk>;

	return {
		chunk$,
		readNext: () => canReadBytes.next()
	};
}

function removeReadsWithUploadedBytes(reads: ReadInstruction[],
		priorUpload: UploadInfo): void {
	if (reads.length < 1) { throw new Error(
		'Read instructions are empty, while prior upload already exists.'); }
	// even if 0 segs uploaded, head has already been sent
	const fstRI = reads[0];
	fstRI.fst = undefined;

	let fstNewReadInd: number|undefined = undefined;
	for (let i=0; i<reads.length; i+=1) {
		const ri = reads[i];
		const riSegsEnd = ri.segsOfs + ri.segs;
		if (riSegsEnd < priorUpload.segsUploaded) { continue; }
		if (riSegsEnd > priorUpload.segsUploaded) {
			const delta = priorUpload.segsUploaded - ri.segsOfs;
			ri.segsOfs = priorUpload.segsUploaded;
			ri.segs -= delta;
			fstNewReadInd = i;
		} else {
			fstNewReadInd = i+1;
		}
		break;
	}

	if (fstNewReadInd === undefined) { throw new Error(
		`Upload progress file shows more uploaded segment bytes, than there is in ready read instructions.`); }
	
	reads.splice(0, fstNewReadInd);
}

Object.freeze(exports);