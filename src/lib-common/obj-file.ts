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

import * as fs from './async-fs-node';
import { DiffInfo } from './service-api/3nstorage/owner';
import { errWithCause } from './exceptions/error';
import { BytesFIFOBuffer } from './byte-streaming/common';

/**
 * This byte sequence starts file with the following layout:
 * 1) 3 bytes with this sequence;
 * 2) 5 bytes with offset, at which segments start;
 * 3) header bytes up to start of segments;
 * 4) segments bytes up to file end.
 */
const ALL_BYTES_FILE_START = new Buffer('all', 'utf8');
/**
 * This byte sequence starts file with the following layout:
 * 1) 3 bytes with this sequence;
 * 2) 5 bytes with offset, at which header starts;
 * 3) 5 bytes with offset, at which segments start;
 * 4) header bytes up to start of segments;
 * 5) segments bytes up to file end.
 */
const DIFF_BYTES_FILE_START = new Buffer('dif', 'utf8');

/**
 * @param u is an unsigned integer (up to 40-bit) to be stored big-endian
 * way in 5 bytes.
 * @return a byte array with number stored in it.
 */
function uintTo5Bytes(u: number): Buffer {
	if (u >= 0x10000000000) { throw new Error(
		'Cannot store number bigger than 2^40-1'); }
	const x = new Buffer(5);
	x[0] = (u / 0x100000000) | 0;
	x[1] = u >>> 24;
	x[2] = u >>> 16;
	x[3] = u >>> 8;
	x[4] = u;
	return x;
}

/**
 * @param x
 * @param i
 * @return unsigned integer (up to 40 bits), stored big-endian way
 * in 5 bytes of x, starting at index i.
 */
function uintFrom5Bytes(x: Buffer|Uint8Array, i = 0): number {
	if (x.length < i+5) { throw new Error(
		'Given array has less than 5 bytes, starting with a given index.'); }
	const l = (x[1] << 24) | (x[2] << 16) | (x[3] << 8) | x[4];
	return (x[0] * 0x100000000) + l;
}

function bytesEqual(a: Buffer|Uint8Array, b: Buffer|Uint8Array): boolean {
	if (a.length !== b.length) { return false; }
	for (let i=0; i<a.length; i+=1) {
		if (a[i] !== b[i]) { return false; }
	}
	return true;
}

/**
 * This parses object file's initial parts that tell at which offsets and what
 * parts are located, etc.
 * @param fd is an open file descriptor, of a file to parse
 */
export async function parseOpenObjFile(fd: number): Promise<{
		headerOffset: number; segsOffset: number;
		diff?: DiffInfo; fileSize: number; }> {
	const buf = new Buffer(13);
	await fs.read(fd, 0, buf).catch((exc: fs.FileException) => {
		if (exc.endOfFile) { throw new Error(
			'File is too short to contain object'); }
		throw exc;
	});
	const fileSize = (await fs.fstat(fd)).size;
	const fileStart = buf.slice(0, 3);
	if (bytesEqual(fileStart, ALL_BYTES_FILE_START)) {
		return {
			headerOffset: 8,
			segsOffset: uintFrom5Bytes(buf.slice(3, 8)),
			fileSize
		};
	} else if (bytesEqual(fileStart, DIFF_BYTES_FILE_START)) {
		const headerOffset = uintFrom5Bytes(buf.slice(3, 8));
		const diffBytes = new Buffer(headerOffset - 13);
		await fs.read(fd, 13, diffBytes);
		let diff: DiffInfo;
		try {
			diff = JSON.parse(diffBytes.toString('utf8'));
		} catch (err) {
			throw errWithCause(err, 'Cannot parse diff from object file');
		}
		return {
			headerOffset,
			segsOffset: uintFrom5Bytes(buf.slice(8, 13)),
			diff,
			fileSize
		};
	} else {
		throw new Error('Object\'s file does not have recognizable byte signature at its start');
	}	
}
/**
 * This parses object file's initial parts that tell at which offsets and what
 * parts are located, etc.
 * @param path is obj file path
 */
export async function parseObjFile(path: string):Promise<{
		headerOffset: number; segsOffset: number;
		diff?: DiffInfo; fileSize: number; }> {
	const fd = await fs.open(path, 'r');
	try {
		const info = await parseOpenObjFile(fd);
		return info;
	} finally {
		await fs.close(fd);
	}
}

/**
 * This function creates object file, and writes all elements, except header
 * and segment bytes. Created file has all necessary structure to be parsable,
 * and to accept header and segments bytes.
 * @param path
 * @param headerOffset
 * @param segsSize
 * @param diffBytes
 */
export async function createObjFile(path: string, headerSize: number,
		segsSize: number, diffBytes?: Uint8Array):
		Promise<{ headerOffset: number; segsOffset: number; }> {
	const { bytes, headerOffset, segsOffset} =
		assembleFileHead(headerSize, segsSize, diffBytes);
	const fileSize = segsOffset + ((segsSize > 0) ? segsSize : 0);

	// create file and write initial parsable part into it
	const fd = (await fs.createEmptyFile(path, fileSize, true))!;
	try {
		await fs.write(fd, 0, Buffer.from(
			bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.length));
	} finally {
		await fs.close(fd);
	}
	
	return { headerOffset, segsOffset };
}

/**
 * This returns a file head bytes with diff (if given)
 * @param headerSize 
 * @param segsSize 
 * @param diffBytes 
 */
export function assembleFileHead(headerSize: number, segsSize: number,
		diffBytes?: Uint8Array):
		{ bytes: Uint8Array; headerOffset: number; segsOffset: number; } {
	// prepare elements of a parsable part of a file
	const headerOffset = (diffBytes ? 13 + diffBytes.length : 8);
	const segsOffset = headerOffset + headerSize;
	
	// put all into one buffer to minimize requests to fs
	const buf = new BytesFIFOBuffer();
	if (diffBytes) {
		buf.push(DIFF_BYTES_FILE_START);
		buf.push(uintTo5Bytes(headerOffset));
		buf.push(uintTo5Bytes(segsOffset));
		buf.push(diffBytes);
	} else {
		buf.push(ALL_BYTES_FILE_START);
		buf.push(uintTo5Bytes(segsOffset));
	}

	return { bytes: buf.getBytes(undefined)!, headerOffset, segsOffset };
}

export function parseOffsets(bytes: Buffer|Uint8Array):
		{ headerOffset: number; segsOffset: number; diffOffset?: number; } {
	const fileStart = bytes.slice(0, 3);
	if (bytesEqual(fileStart, ALL_BYTES_FILE_START)) {
		return {
			headerOffset: 8,
			segsOffset: uintFrom5Bytes(bytes.slice(3, 8)),
		};
	} else if (bytesEqual(fileStart, DIFF_BYTES_FILE_START)) {
		return {
			headerOffset: uintFrom5Bytes(bytes.slice(3, 8)),
			segsOffset: uintFrom5Bytes(bytes.slice(8, 13)),
			diffOffset: 13,
		};
	} else {
		throw new Error('Object\'s file does not have recognizable byte signature at its start');
	}	
}

Object.freeze(exports);