/*
 Copyright (C) 2018, 2020 3NSoft Inc.

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

import { constants as masks } from 'fs';
import { makeFileException, Code as excCode } from '../../lib-common/exceptions/file';
import { Stats } from 'fuse-bindings';
import { EMPTY_BUFFER } from '../../lib-common/buffer-utils';
import { FSMount } from './fs-mount';
import { Roots } from './descriptors';


type FS = web3n.files.FS;
type WritableFS = web3n.files.WritableFS;
type FileByteSink = web3n.files.FileByteSink;


// Note. It seems that Linux's FUSE keeps track of the purpose, for which
// descriptor is created. Hence, we don't track these parameters.
// This behaviour should be checked for OSX and Windows' Dokany, especially
// with append. On Linux FUSE calculates proper position for write, so that
// write doesn't have to know that it is an appending operation. Is same true
// on other platforms?
export class Descriptor {

	private lastWrite: {
		fd: number|undefined;
		sink: FileByteSink;
	}|undefined = undefined;

	constructor(
		protected readonly root: FS,
		public readonly path: string,
	) { }

	/**
	 * This returns existing or new sink in a promise.
	 * @param fd if given, sink is related to this numberic identifier, and
	 * this descriptor doesn't have to be flushed after sink was used. If not
	 * given, or undefined, this descriptor must be flashed to complete and
	 * detach given 
	 */
	private async getSink(fd?: number): Promise<FileByteSink> {
		if (this.lastWrite) {
			if (fd === undefined) {
				await this.flush();
			} else if (this.lastWrite.fd === fd) {
				return this.lastWrite.sink;
			}
		}
		this.lastWrite = {
			fd,
			sink: await (this.root as WritableFS).getByteSink(this.path, {})
		};
		return this.lastWrite.sink;
	}

	async fileWrite(
		fd: number, buffer: Buffer, length: number, position: number
	): Promise<void> {
		const sink = await this.getSink(fd);
		try {
			const initSize = await sink.getSize();
			if (initSize < position) {
				await sink.truncate(position);
			}
			// Beware, FUSE may reuse buffer, but only after cb is triggered.
			// Sink implementation is expected to be done with buffer when the
			// wait completes.
			await sink.splice(position, length, buffer.slice(0, length));
		} catch (err) {
			await this.clearAndRethrowErr(err);
		}
	}

	private async clearAndRethrowErr(err: any): Promise<never> {
		if (this.lastWrite) {
			const sink = this.lastWrite.sink;
			this.lastWrite = undefined;
			await sink.done(err).catch(noop);
		}
		throw err;
	}

	async fileTruncate(size: number, fd?: number): Promise<void> {
		const sink = await this.getSink(fd);
		try {
			await sink.truncate(size);
			if (fd === undefined) {
				await this.flush();
			}
		} catch (err) {
			await this.clearAndRethrowErr(err);
		}
	}

	/**
	 * This flushes file sink, is present. An error may be thrown if error occurs
	 * during this call. But there will be no error when flush is done with
	 * error.
	 * @param fd
	 * @param withEEOF is an optional flag. When true, this flushes error down
	 * the file sink. Default value is false.
	 */
	async flush(fd?: number, withEEOF = false): Promise<void> {
		if (!this.lastWrite) { return; }
		if ((fd !== undefined) && (this.lastWrite.fd !== fd)) { return; }
		const sink = this.lastWrite.sink;
		this.lastWrite = undefined;
		if (withEEOF) {
			const err = makeFileException(excCode.endOfFile, this.path);
			await sink.done(err).catch(noop);
		} else {
			await sink.done();
		}
	}

	async getattr(
		ctx: FSMount['ctx'], getDevId: Roots['getDevId']
	): Promise<Stats> {
		const stats = await this.root.stat(this.path);
		const dev = getDevId(this.root);
		const fuseStats = toPartialFUSEStats(stats);
		fuseStats.uid = ctx.uid;
		fuseStats.gid = ctx.gid;
		fuseStats.dev = dev;
		return fuseStats as Stats;
	}

	async readdir(): Promise<string[]> {
		const lst = await this.root.listFolder(this.path);
		return lst.map(e => e.name);
	}

	isInWritableFS(): boolean {
		return this.root.writable;
	}

	checkFilePresence(throwIfMissing: boolean): Promise<boolean> {
		return this.root.checkFilePresence(this.path, throwIfMissing);
	}

	async flushAndStartBytesRead(
		pos: number, len: number
	): Promise<{ bytesPromise: ReturnType<FS['readBytes']>; }> {
		await this.flush();
		return {
			bytesPromise: this.root.readBytes(this.path, pos, pos+len)
		};
	}

	async createFile(fd?: number): Promise<void> {
		await this.flush();
		if (fd === undefined) {
			await (this.root as WritableFS).writeBytes(
				this.path, EMPTY_BUFFER, { create: true, exclusive: true });
		} else {
			this.lastWrite = {
				fd,
				sink: await (this.root as WritableFS).getByteSink(
					this.path, { create: true, exclusive: true })
			};
		}
	}

	async deleteFile(): Promise<void> {
		await (this.root as WritableFS).deleteFile(this.path);
	}

	isOnSameFSWith(d: Descriptor): boolean {
		return (this.root === d.root);
	}

	async moveTo(dst: Descriptor): Promise<void> {
		await (this.root as WritableFS).move(this.path, dst.path);
	}

	async makeFolder(): Promise<void> {
		await (this.root as WritableFS).makeFolder(this.path, true);
	}

	async deleteFolder(): Promise<void> {
		await (this.root as WritableFS).deleteFolder(this.path);
	}

}
Object.freeze(Descriptor.prototype);
Object.freeze(Descriptor);


function noop () {}

const BLOCK_SIZE = 4*1024;

const PAST_TS = new Date('2015-01-01');

function toPartialFUSEStats(stats: web3n.files.Stats): Partial<Stats> {
	let mode = 0;
	if (stats.isFile) {
		mode = (stats.writable ? RW_FILE_MODE : RO_FILE_MODE);
	} else if (stats.isFolder) {
		mode = (stats.writable ? RW_DIR_MODE : RO_DIR_MODE);
	} else if (stats.isLink) {
		mode = LINK_MODE;
	} else {
		throw new Error(`Unknown or missing type in stats object`);
	}
	const size = (stats.size ? stats.size : 0);
	const blocks = (stats.size ?
		(Math.round(stats.size/BLOCK_SIZE) + (stats.size%BLOCK_SIZE ? 1 : 0)) :
		0);
	const ctime = (stats.ctime ? stats.ctime : PAST_TS);
	const mtime = (stats.mtime ? stats.mtime : ctime);
	const atime = mtime;
	return {
		mode,
		size, blocks, blksize: BLOCK_SIZE,
		atime, mtime, ctime
	};
}

const RO_FILE_MODE = masks.S_IFREG | masks.S_IRUSR;
const RW_FILE_MODE = masks.S_IFREG | masks.S_IRUSR | masks.S_IWUSR;
const RO_DIR_MODE = masks.S_IFDIR | masks.S_IRUSR | masks.S_IXUSR;
const RW_DIR_MODE = masks.S_IFDIR | masks.S_IRUSR | masks.S_IWUSR | masks.S_IXUSR;
const LINK_MODE = masks.S_IFLNK | masks.S_IRUSR;


Object.freeze(exports);