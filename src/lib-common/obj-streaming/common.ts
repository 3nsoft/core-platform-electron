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

import { bind } from '../binding';
import { ByteSink, ByteSource } from '../byte-streaming/common';

/**
 * Object has to parts: header and segments.
 * Header is usually consumed as a whole thing, while segments need a
 * byte source for access.
 * All methods should be usable when called separately from the object, i.e.
 * all methods must be functions, already bound to some state/closure.
 */
export interface ObjSource {
	
	version: number;
	
	/**
	 * This returns a promise, resolvable to a complete header byte array.
	 */
	readHeader(): Promise<Uint8Array>;
	
	segSrc: ByteSource;
}

export function wrapObjSourceImplementation(impl: ObjSource): ObjSource {
	const w: ObjSource = {
		version: impl.version,
		readHeader: bind(impl, impl.readHeader),
		segSrc: impl.segSrc
	};
	return w;
}

/**
 * Object has to parts: header and segments.
 * Header is usually created as a whole thing, while segments are created in
 * chunks that require sink.
 * All methods should be usable when called separately from the object, i.e.
 * all methods must be functions, already bound to some state/closure.
 */
export interface ObjSink {
	
	version: number;
	
	/**
	 * This method writes a whole of object header in one call.
	 * @param bytes is a byte array with object's header bytes
	 * @param err is an optional parameter, that pushes error along a pipe if
	 * such is setup.
	 * @return a promise, resolvable when write operation is done.
	 */
	writeHeader(bytes: Uint8Array|null, err?: any): Promise<void>;

	segSink: ByteSink;
}

export function wrapObjSinkImplementation(impl: ObjSink): ObjSink {
	const w: ObjSink = {
		version: impl.version,
		writeHeader: bind(impl, impl.writeHeader),
		segSink: impl.segSink
	};
	return w;
}

Object.freeze(exports);