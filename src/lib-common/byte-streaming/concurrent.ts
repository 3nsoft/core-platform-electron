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

import { ByteSink, ByteSource } from './common';
import { SingleProc } from '../processes';
import { bind } from '../binding';

export function syncWrapByteSource(src: ByteSource,
		readingProc = new SingleProc<any>()): ByteSource {
	let synced: ByteSource = {
		getSize: bind(src, src.getSize),
		read: (len: number): Promise<Uint8Array> => {
			return readingProc.startOrChain(() => {
				return src.read(len);
			});
		}
	};
	if (src.seek) {
		synced.seek = (offset: number): Promise<void> => {
			return readingProc.startOrChain(() => {
				return src.seek!(offset);
			});
		};
		synced.getPosition = (): Promise<number> => {
			return readingProc.startOrChain(() => {
				return src.getPosition!();
			});
		};
	}
	return synced;
}

export function syncWrapByteSink(sink: ByteSink,
		writingProc = new SingleProc<any>()): ByteSink {
	let synced: ByteSink = {
		getSize: (): Promise<number> => {
			return writingProc.startOrChain(() => {
				return sink.getSize();
			});
		},
		setSize: (size: number): Promise<void> => {
			return writingProc.startOrChain(() => {
				return sink.setSize(size);
			});
		},
		write: (bytes: Uint8Array, err?: any): Promise<void> => {
			return writingProc.startOrChain(() => {
				return sink.write(bytes, err);
			});
		}
	};
	if (sink.seek) {
		synced.seek = (offset: number): Promise<void> => {
			return writingProc.startOrChain(() => {
				return sink.seek!(offset);
			});
		};
		synced.getPosition = (): Promise<number> => {
			return writingProc.startOrChain(() => {
				return sink.getPosition!();
			});
		};
	}
	return synced;
}

Object.freeze(exports);