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

import { DiffInfo } from '../../../../lib-common/service-api/3nstorage/owner';
import { utf8 } from '../../../../lib-common/buffer-utils';
import { parseObjFileOffsets, parseDiffAndOffsets, parseOffsets }
	from '../../../../lib-client/obj-file-on-dev-fs';
import { Objs, ObjId } from './objs';
import { LOCAL_FILE_NAME_EXT } from './local-versions';

export interface ObjReader {
	
	/**
	 * This function promises to return object's header bytes.
	 * @param objId
	 * @param version specifying required object version
	 */
	readObjHeader(objId: ObjId, version: number): Promise<Uint8Array>;
	
	/**
	 * This function promises to return a byte array, read from object segments.
	 * Note that, if this is a diff-ed version, these will be bytes from a new
	 * byte array, which may not correspond to proper version bytes, as proper
	 * version includes bytes from a base version.
	 * @param objId
	 * @param version
	 * @param start
	 * @param end
	 */
	readObjSegments(objId: ObjId, version: number, start: number,
		end: number): Promise<Uint8Array|undefined>;
	
	/**
	 * This function promises to return a segments length of given object
	 * version in cache.
	 * @param objId
	 * @param version
	 * @param countBase if version is recorded as a diff, this flag's true
	 * (default) value, ensures that relevant base bytes are accounted for.
	 * Otherwise, false value, ensures that only new to this version bytes
	 * are accounted for.  
	 */
	getSegsSize(objId: ObjId, version: number, countBase?: boolean):
		Promise<number>;
	
	/**
	 * This function promises to return either object's diff, if object version
	 * is defined via diff, or an undefined, otherwise.
	 * @param objId
	 * @param version specifying required object version
	 */
	readObjDiff(objId: ObjId, version: number): Promise<DiffInfo|undefined>;

	readFirstRawChunk(objId: ObjId, version: number, chunkSize: number):
		Promise<{ diff?: number; header: number; segsLen: number;
			chunk: Uint8Array }>;
	
	readObjInfo(objId: ObjId, version: number):
			Promise<{ diff?: DiffInfo; header: Uint8Array; segsLen: number; }>;

}

const OBJ_INFO_READ_LEN = 32*1024;

export class ObjFileReader implements ObjReader {
	
	private fileExt: string;

	constructor(
			private objs: Objs,
			objType: 'synced' | 'local') {
		if (objType === 'synced') {
			this.fileExt = '';
		} else if (objType === 'local') {
			this.fileExt = LOCAL_FILE_NAME_EXT;
		} else {
			throw new Error(`Unknown obj type: ${objType}`);
		}
		Object.freeze(this);
	}
	
	private async filePath(objId: ObjId, version: number): Promise<string> {
		const objFolder = await this.objs.getObjFolder(objId);
		return `${objFolder}/${version}.${this.fileExt}`;
	}

	async readObjSegments(objId: ObjId, version: number, start: number,
			end: number): Promise<Uint8Array|undefined> {
		const path = await this.filePath(objId, version);
		const { segsOffset } = await parseObjFileOffsets(this.objs.fs, path);
		return await this.objs.fs.readBytes(path,
			start+segsOffset, end+segsOffset);
	}
	
	async getSegsSize(objId: ObjId, version: number, countBase = true):
			Promise<number> {
		const path = await this.filePath(objId, version);
		const { segsOffset, diff } =
			await parseDiffAndOffsets(this.objs.fs, path);
		if (countBase && diff) {
			return diff.segsSize;
		} else {
			const stats = await this.objs.fs.stat(path);
			if (typeof stats.size !== 'number') { throw new Error(
				`Stat of file on disk didn't return a numeric size.`); }
			return stats.size - segsOffset;
		}
	}
	
	async readObjHeader(objId: ObjId, version: number): Promise<Uint8Array> {
		const path = await this.filePath(objId, version);
		const { headerOffset, segsOffset } =
			await parseObjFileOffsets(this.objs.fs, path);
		const header = await this.objs.fs.readBytes(path,
			headerOffset, segsOffset);
		if (!header || (header.length < (segsOffset - headerOffset))) {
			throw new Error(`Object file ${path} is too short.`); }
		return header;
	}

	async readObjDiff(objId: ObjId, version: number):
			Promise<DiffInfo|undefined> {
		const path = await this.filePath(objId, version);
		const { diff } = await parseDiffAndOffsets(this.objs.fs, path);
		return diff;
	}

	async readFirstRawChunk(objId: ObjId, version: number, chunkSize: number):
			Promise<{ diff?: number; header: number; segsLen: number;
				chunk: Uint8Array }> {
		const path = await this.filePath(objId, version);
		const chunk = await this.objs.fs.readBytes(path, 0, chunkSize);
		if (!chunk || (chunk.length < 13)) { throw new Error(
			`Object file ${path} is unexpectedly too short`); }
		const { diffOffset, headerOffset, segsOffset } = parseOffsets(chunk);
		const fileSize = (await this.objs.fs.stat(path)).size!;
		return {
			diff: (diffOffset ? (headerOffset - diffOffset) : undefined),
			header: segsOffset - headerOffset,
			segsLen: fileSize - segsOffset,
			chunk: (diffOffset ?
				chunk.subarray(diffOffset) : chunk.subarray(headerOffset))
		};
	}

	async readObjInfo(objId: ObjId, version: number):
			Promise<{ diff?: DiffInfo; header: Uint8Array; segsLen: number; }> {
		const { chunk, diff, header, segsLen } = await this.readFirstRawChunk(
			objId, version, OBJ_INFO_READ_LEN);
		if (diff) {
			return {
				header: chunk.subarray(diff, diff + header),
				segsLen,
				diff: JSON.parse(utf8.open(chunk.subarray(0, diff)))
			};
		} else {
			return {
				header: chunk.subarray(0, header),
				segsLen,
			};
		}
	}

	wrap(): ObjReader {
		const w: ObjReader = {
			getSegsSize: this.objs.syncAndBind(this, this.getSegsSize),
			readObjDiff: this.objs.syncAndBind(this, this.readObjDiff),
			readObjHeader: this.objs.syncAndBind(this, this.readObjHeader),
			readObjSegments: this.objs.syncAndBind(this, this.readObjSegments),
			readFirstRawChunk: this.objs.syncAndBind(this, this.readFirstRawChunk),
			readObjInfo: this.objs.syncAndBind(this, this.readObjInfo)
		};
		Object.freeze(w);
		return w;
	}

}
Object.freeze(ObjFileReader.prototype);
Object.freeze(ObjFileReader);

Object.freeze(exports);