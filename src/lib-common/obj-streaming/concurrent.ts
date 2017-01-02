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

import { ObjSink, ObjSource } from './common';
import { syncWrapByteSource, syncWrapByteSink }
	from '../byte-streaming/concurrent';
import { SingleProc } from '../processes';
import { bind } from '../binding';

export function syncWrapObjSource(src: ObjSource,
		readingProc = new SingleProc<any>()): ObjSource {
	let synced: ObjSource = {
		getObjVersion: bind(src, src.getObjVersion),
		readHeader: (): Promise<Uint8Array> => {
			return readingProc.startOrChain(() => {
				return src.readHeader();
			});
		},
		segSrc: syncWrapByteSource(src.segSrc, readingProc)
	};
	return synced;
}

export function syncWrapObjSink(sink: ObjSink,
		writingProc = new SingleProc<any>()): ObjSink {
	let synced: ObjSink = {
		setObjVersion: bind(sink, sink.setObjVersion),
		writeHeader: (bytes: Uint8Array|null, err?: any): Promise<void> => {
			return writingProc.startOrChain(() => {
				return sink.writeHeader(bytes, err);
			});
		},
		segSink: syncWrapByteSink(sink.segSink)
	};
	return synced;
}

Object.freeze(exports);