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

import { assembleFileHead, parseOffsets } from '../lib-common/obj-file';
import { DiffInfo } from '../lib-common/service-api/3nstorage/owner';
import { toBuffer } from '../lib-common/buffer-utils';

export { parseOffsets } from '../lib-common/obj-file';

type Sink = web3n.ByteSink;

/**
 * This writes object file bytes into given sink. If segs are given, sink will
 * be closed, if segs are not given, sink is left open.
 * @param sink 
 * @param diff 
 * @param header 
 * @param segs 
 * @param closeSink 
 */
export async function writeObjTo(sink: Sink, diff: Uint8Array|undefined,
		header: Uint8Array, segs?: Uint8Array, closeSink = false):
		Promise<void> {
	const { bytes } = assembleFileHead(header.length, diff);
	await sink.write(bytes);
	await sink.write(header);
	if (segs && (segs.length > 0)) {
		await sink.write(segs);
	}
	if (closeSink) {
		await sink.write(null);
	}
}

type ReadonlyFS = web3n.files.ReadonlyFS;

export async function parseObjFileOffsets(fs: ReadonlyFS, path: string):
		Promise<{ headerOffset: number;
			segsOffset: number; diffOffset?: number; }> {
	const h = await fs.readBytes(path, 0, 13);
	if (!h || (h.length < 13)) { throw new Error(
		`Object file ${path} is too short.`); }
	return parseOffsets(h);
}

export async function parseDiffAndOffsets(fs: ReadonlyFS, path: string):
		Promise<{ diff?: DiffInfo; segsOffset: number; headerOffset: number; }> {
	const { diffOffset, headerOffset, segsOffset } =
		await parseObjFileOffsets(fs, path);
	if (diffOffset) {
		const diffBytes = await fs.readBytes(path, diffOffset, headerOffset);
		if (!diffBytes || (diffBytes.length < (headerOffset - diffOffset!))) {
			throw new Error(`Object file ${path} is too short.`); }
		const diff = <DiffInfo> JSON.parse(toBuffer(diffBytes).toString('utf8'));
		return { diff, segsOffset, headerOffset };
	} else {
		return { headerOffset, segsOffset };
	}
}

Object.freeze(exports);