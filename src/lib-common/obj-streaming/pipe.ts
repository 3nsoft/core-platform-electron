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

import { ByteSink, ByteSource } from '../byte-streaming/common';
import { SinkBackedByteSource } from '../byte-streaming/pipe';
import { ObjSink, ObjSource, wrapObjSourceImplementation,
	wrapObjSinkImplementation } from './common';

interface Deferred {
	resolve(result?: any): void;
	reject(cause: any): void;
}

export class SinkBackedObjSource implements ObjSink, ObjSource {
	
	private header: Uint8Array|undefined = undefined;
	private deferredHeader: Deferred|undefined = undefined;
	private headerPromise: Promise<Uint8Array> | undefined = undefined;
	private err: any = undefined;
	private segs = new SinkBackedByteSource();

	constructor(
			public version: number) {}

	get segSink(): ByteSink {
		return this.segs.getSink();
	}

	get segSrc(): ByteSource {
		return this.segs.getSource();
	}
	
	async readHeader(): Promise<Uint8Array> {
		if (this.header) {
			return this.header;
		} else if (this.err) {
			throw this.err;
		} else if (this.headerPromise) {
			return this.headerPromise;
		} else {
			this.headerPromise = new Promise<Uint8Array>((resolve, reject) => {
				this.deferredHeader = { resolve, reject };
			});
			return this.headerPromise;
		}
	}
	
	async writeHeader(bytes: Uint8Array, err?: any): Promise<void> {
		if (this.header) {
			throw new Error('Header has already been written.');
		} else if (bytes) {
			this.header = bytes;
			if (this.deferredHeader) {
				this.deferredHeader.resolve(this.header);
				this.deferredHeader = undefined;
				this.headerPromise = undefined;
			}
		} else if (err) {
			this.err = err;
			if (this.deferredHeader) {
				this.deferredHeader.reject(this.err);
				this.deferredHeader = undefined;
				this.headerPromise = undefined;
			}
		}
	}
	
	getSource(): ObjSource {
		return wrapObjSourceImplementation(this);
	}
	
	getSink(): ObjSink {
		return wrapObjSinkImplementation(this);
	}
	
}

Object.freeze(exports);