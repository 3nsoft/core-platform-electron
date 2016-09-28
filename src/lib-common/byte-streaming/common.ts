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

import { bind } from '../binding';

export type ByteSource = Web3N.ByteSource;

export function wrapByteSourceImplementation(src: ByteSource): ByteSource {
	let wrap: ByteSource = {
		read: bind(src, src.read),
		getSize: bind(src, src.getSize)
	};
	if (src.seek) {
		wrap.seek = bind(src, src.seek);
		wrap.getPosition = bind(src, src.getPosition);
	}
	return wrap;
}

export type ByteSink = Web3N.ByteSink; 

export function wrapByteSinkImplementation(sink: ByteSink): ByteSink {
	let wrap: ByteSink = {
		setSize: bind(sink, sink.setSize),
		write: bind(sink, sink.write),
		getSize: bind(sink, sink.getSize)
	};
	if (sink.seek) {
		wrap.seek = bind(sink, sink.seek);
		wrap.getPosition = bind(sink, sink.getPosition);
	}
	return wrap;
}

export class BytesFIFOBuffer {
	
	private queue: Uint8Array[] = [];
	private queueLen = 0;
	get length(): number {
		return this.queueLen;
	}
	
	constructor() {
		Object.seal(this);
	}
	
	clear(): void {
		this.queue = [];
		this.queueLen = 0;
	}
	
	push(bytes: Uint8Array): void {
		if (bytes.length === 0) { return; }
		this.queue.push(bytes);
		this.queueLen += bytes.length;
	}
	
	/**
	 * @param extractLen is number of bytes to extract. It must always be less,
	 * or equal to current length of queue.
	 * @return requested bytes
	 */
	private extractSomeBytesFrom(extractLen: number): Uint8Array {
		if (this.queue.length === 0) { return null; }
		let extract = new Uint8Array(extractLen);
		let offset = 0;
		while (offset < extractLen) {
			let chunk = this.queue[0];
			if ((offset + chunk.length) <= extractLen) {
				extract.set(chunk, offset);
				offset += chunk.length;
				this.queue.shift();
			} else {
				extract.set(chunk.subarray(0, extractLen-offset), offset);
				this.queue[0] = chunk.subarray(extractLen-offset);
				break;
			}
		}
		return extract;
	}
	
	private extractAllBytesFrom(): Uint8Array {
		return this.extractSomeBytesFrom(this.queueLen);
	}
		
	/**
	 * @param len is a number of bytes to get.
	 * If null is given, all bytes should be returned.
	 * @return an array of bytes, or null, if there are not enough bytes.
	 */
	getBytes(len: number, canBeLess = false): Uint8Array {
		if (this.queue.length === 0) { return null; }
		let extract: Uint8Array;
		if (typeof len !== 'number') {
			extract = this.extractAllBytesFrom();
		} else {
			if (len < 1) { throw new Error('Length parameter is illegal: '+len); }
			if (this.queueLen < len) {
				if (canBeLess) {
					extract = this.extractAllBytesFrom();
				} else {
					return null;
				}
			} else {
				extract = this.extractSomeBytesFrom(len);
			}
		}
		if (extract) {
			this.queueLen -= extract.length;
		}
		return extract;
	}
	
}
Object.freeze(BytesFIFOBuffer.prototype);
Object.freeze(BytesFIFOBuffer);

/**
 * @param bytes
 * @return a seekable byte source, based on a given byte array.
 */
export function sourceFromArray(bytes: Uint8Array): ByteSource {
	let pos = 0;
	let src: ByteSource = {
		getPosition: async (): Promise<number> => { return pos; },
		getSize: async (): Promise<number> => { return bytes.length; },
		read: async (len: number): Promise<Uint8Array> => {
			if (len === null) { return bytes.subarray(pos); }
			if ((typeof len !== 'number') || (len < 0)) { throw new TypeError(
				`Illegal length parameter given: ${len}`); }
			let chunk = bytes.subarray(pos, pos+len);
			pos += chunk.length;
			return chunk;
		},
		seek: async (newPos: number): Promise<void> => {
			if ((typeof newPos !== 'number') || (newPos < 0)) {
				throw new TypeError(`Illegal position given: ${newPos}`); }
			if (newPos > bytes.length) { throw new Error(
				`Position parameter is out of bound`); }
			pos = newPos;
		}
	};
	return src;
}

Object.freeze(exports);