/*
 Copyright (C) 2015 - 2017 3NSoft Inc.
 
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

import { BytesFIFOBuffer, ByteSink, ByteSource, wrapByteSinkImplementation,
	wrapByteSourceImplementation } from './common';
import { bind } from '../binding';

interface Deferred {
	resolve(result?: any): void;
	reject(cause: any): void;
}

export class SinkBackedByteSource implements ByteSource, ByteSink {
	
	private totalSize: number|undefined = undefined;
	private isTotalSizeSet = false;
	private collectedBytes = 0;
	private isComplete = false;
	private buf = new BytesFIFOBuffer();
	private deferredRead: {
		deferred: Deferred;
		len: number;
	}|undefined = undefined;
	private swalledErr: any = undefined;
	
	getSource(): ByteSource {
		return wrapByteSourceImplementation(this);
	}
	
	getSink(): ByteSink {
		return wrapByteSinkImplementation(this);
	}
	
	async getSize(): Promise<number|undefined> {
		return this.totalSize;
	}
	
	async setSize(size: number|undefined): Promise<void> {
		if (this.isTotalSizeSet) {
			throw new Error("Total size has already been set");
		} else if ((typeof size === 'number') && (size < this.collectedBytes)) {
			throw new Error("Given size is less than number of "+
				"already collected bytes.");
		}
		this.isTotalSizeSet = true;
		this.totalSize = ((typeof size === 'number') ? size : undefined);
	}
	
	read(len: number): Promise<Uint8Array|undefined> {
		if (this.deferredRead) {
			throw new Error("There is already pending read");
		}
		return new Promise<Uint8Array|undefined>((resolve, reject) => {
			if (this.swalledErr) {
				reject(this.swalledErr);
				return;
			}
			if (this.isComplete) {
				resolve(this.buf.getBytes(len, true));
				return;
			}
			if (typeof len === 'number') {
				const bufferedBytes = this.buf.getBytes(len);
				if (bufferedBytes) {
					resolve(bufferedBytes);
					return;
				}
			}
			this.deferredRead = {
				len,
				deferred: { resolve, reject }
			};
		})
	}
	
	private completeOnErr(err: any): void {
		if (this.deferredRead) {
			this.deferredRead.deferred.reject(err);
			this.deferredRead = undefined; 
		} else {
			this.swalledErr = err;
		}
	}
	
	async write(bytes: Uint8Array|null, err?: any): Promise<void> {
		if (this.isComplete) {
			if (bytes === null) {
				return;
			} else {
				throw new Error("Complete sink cannot except any more bytes.");
			}
		}
		let boundsErr: Error|undefined;
		if (bytes === null) {
			if (err) {
				this.completeOnErr(err);
				return;
			}
			this.isComplete = true;
			if (this.totalSize === undefined) {
				this.totalSize = this.collectedBytes;
			} else if (this.totalSize < this.collectedBytes) {
				boundsErr = new Error("Stopping bytes at "+this.collectedBytes+
					", which is sooner than declared total size "+
					this.totalSize+".");
			}
		} else {
			if (bytes.length === 0) { return; }
			if (this.totalSize !== undefined) {
				const maxBytesExpectation = this.totalSize - this.collectedBytes;
				if (bytes.length >= maxBytesExpectation) {
					this.isComplete = true;
					if (bytes.length > maxBytesExpectation) {
						boundsErr = new Error("More bytes given than sink was "+
							"set to accept; swallowing only part of bytes.");
						if (maxBytesExpectation === 0) { throw boundsErr; }
						bytes = bytes.subarray(0, maxBytesExpectation);
					}
				}
			}
			this.buf.push(bytes);
			this.collectedBytes += bytes.length;
		}
		if (!this.deferredRead) { return; }
		if (this.isComplete) {
			this.deferredRead.deferred.resolve(
				this.buf.getBytes(this.deferredRead.len, true));
			this.deferredRead = undefined;
		} else {
			const bufferedBytes = this.buf.getBytes(this.deferredRead.len);
			if (bufferedBytes) {
				this.deferredRead.deferred.resolve(bufferedBytes);
				this.deferredRead = undefined;
			}
		}
		if (boundsErr) { throw boundsErr; }
	}
	
}

/**
 * This function pipes bytes from a given source to a given sink. Returned
 * promise resolves to a total number of piped bytes.
 * @param src
 * @param sink
 * @param progressCB is an optional progress callback that
 * @param closeSink is an optional parameter, which true (default) value closes
 * sink, when piping is done, while false value keeps sink open.
 * @param bufSize is an optional parameter for buffer, used for byte transfer.
 * Default value is 64K.
 */
export async function pipe(src: ByteSource, sink: ByteSink,
		progressCB: ((bytesPiped: number) => void)|undefined = undefined,
		closeSink = true, bufSize = 64*1024): Promise<number> {
	try {
		let buf = await src.read(bufSize);
		let bytesPiped = 0;
		while (buf) {
			await sink.write(buf);
			bytesPiped += buf.length;
			if (progressCB) { progressCB(bytesPiped); }
			buf = await src.read(bufSize);
		}
		if (closeSink) {
			await sink.write(null);
		}
		return bytesPiped;
	} catch (err) {
		if (closeSink) {
			await sink.write(null, err);
		}
		throw err;
	}
}

Object.freeze(exports);