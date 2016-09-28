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

import * as fs from '../../lib-common/async-fs-node';
import { makeFileException, FileException, Code as excCode,
	makeFileExceptionFromNodes, maskPathInExc }
	from '../../lib-common/exceptions/file';
import { ByteSource, ByteSink } from '../../lib-common/byte-streaming/common';
import { syncWrapByteSink, syncWrapByteSource }
	from '../../lib-common/byte-streaming/concurrent';
import { toBuffer } from '../../lib-common/buffer-utils';
import { splitPathIntoParts, AbstractFS, wrapFSImplementation } from '../files';

export { pathStaysWithinItsRoot } from '../files';

class FileByteSource implements ByteSource {
	
	private offset = 0;
	private size = null;
	
	constructor(
			private path: string,
			private pathPrefixMaskLen: number,
			stat: fs.Stats) {
		this.size = stat.size;
		Object.seal(this);
	}
	
	async getSize(): Promise<number> {
		return this.size;
	}
	
	async read(len: number): Promise<Uint8Array> {
		if (this.offset >= this.size) { return null; }
		let fd: number = null;
		try {
			fd = await fs.open(this.path, 'r');
			let buf: Buffer;
			if (typeof len === 'number') {
				len = Math.min(this.size - this.offset, len);
				buf = new Buffer(len);
			} else {
				buf = new Buffer(this.size - this.offset);
			}
			await fs.readToBuf(fd, this.offset, buf);
			this.offset += buf.length;
			return buf;
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		} finally {
			if (fd !== null) { await fs.close(fd); }
		}
	}
	
	async seek(offset: number): Promise<void> {
		if ((offset < 0) || (offset > this.size)) { throw new Error(
			`Given offset ${offset} is out of bounds.`); }
		this.offset = offset;
	}

	async getPosition(): Promise<number> {
		return this.offset;
	}

}
Object.freeze(FileByteSource.prototype);
Object.freeze(FileByteSource);

class FileByteSink implements ByteSink {

	private offset = 0;
	private size = null;
	
	constructor(
			private path: string,
			private pathPrefixMaskLen: number,
			stat: fs.Stats) {
		this.seek(0);
		this.size = stat.size;
		Object.seal(this);
	}
	
	async write(bytes: Uint8Array, err?: any): Promise<void> {
		if (err || (bytes === null)) {
			this.path = null;
			return;
		}
		if (bytes.length === 0) { return; }
		let fd: number = null;
		try {
			fd = await fs.open(this.path, 'r+');
			let bytesWritten = 0;
			let buf = ((bytes instanceof Buffer) ? bytes : Buffer.from(
				bytes.buffer, bytes.byteOffset, bytes.length));
			await fs.writeFromBuf(fd, this.offset, buf);
			this.offset += buf.length;
			if (this.size < this.offset) {
				this.size = this.offset;
			}
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		} finally {
			if (fd !== null) { await fs.close(fd); }
		}
	}
	
	async setSize(size: number): Promise<void> {
		if (size < 0) { throw new Error(`Given size ${size} is out of bounds.`); }
		await fs.truncate(this.path, size);
	}
	
	async seek(offset: number): Promise<void> {
		if (!this.path) { throw new Error('Cannot seek in closed sink.'); }
		if ((offset < 0) || (offset > this.size)) { throw new Error(
			`Given offset ${offset} is out of bounds.`); }
		this.offset = offset;
	}

	async getPosition(): Promise<number> {
		return this.offset;
	}
	
	async getSize(): Promise<number> {
		if (!this.path) { throw new Error('Cannot size a closed sink.'); }
		return this.size;
	}
	
}
Object.freeze(FileByteSink.prototype);
Object.freeze(FileByteSink);

/**
 * This recursively creates folder, or ensures its presence with non-exclusive
 * parameter.
 * @param root is a path to root folder, and it is assumed to exist.
 * @param path of the folder, relative to root.
 * @param exclusive is like exclusive for making file.
 * When set to true, and folder already exists, exception is thrown.
 * This parameter is optional, and its default value is false, i.e.
 * non-exclusive.
 * @return a promise, resolvable, when operation is complete.
 */
async function makeFolder(root: string, path: string[], exclusive = false):
		Promise<void> {
	if (path.length === 0) { throw new Error('Invalid file path'); }
	let pathStr = root;
	let lastIndex = path.length-1;
	for (let i=0; i < path.length; i+=1) {
		pathStr += '/'+path[i];
		let stats = await fs.stat(pathStr).catch((exc: FileException) => {
			if (exc.code !== excCode.notFound) {
				throw maskPathInExc(root.length, exc); }
			return fs.mkdir(pathStr)
			.catch((exc: FileException) => {
				if (!exc.alreadyExists) { throw exc; }
			});	// resolves to undefined, leading to !stats
		});
		if (!stats) { continue; }
		if (!stats.isDirectory()) {
			throw makeFileException(excCode.notDirectory,
				'Non-directory path: '+path.slice(0, i+1).join('/'));
		} else if ((i === lastIndex) && exclusive) {
			throw makeFileException(excCode.alreadyExists,
				'Directory already exists, path: '+path.join('/'));
		}
	}
}

async function checkPresence(ofFolder: boolean, root: string, path: string[],
		throwIfMissing: boolean): Promise<boolean> {
	try {
		let stats = await fs.stat(root+'/'+path.join('/'));
		return (ofFolder ? stats.isDirectory() : stats.isFile());
	} catch (exc) {
		if (!throwIfMissing && (exc.code === excCode.notFound)) {
			return false;
		}
		throw maskPathInExc(root.length, exc);
	}
}

export type FileStats = Web3N.Files.FileStats;
export type FS = Web3N.Files.FS;
export type ListingEntry = Web3N.Files.ListingEntry;

export class DeviceFS extends AbstractFS {
	
	constructor(
			private root: string) {
		super();
		Object.freeze(this);
	}
	
	static async make(root: string): Promise<FS> {
		let stat = await fs.stat(root).catch((e) => {
			throw maskPathInExc(0, e);
		});
		if (!stat.isDirectory()) {
			throw makeFileException(excCode.notDirectory, `Not a folder given as filesystem root ${root}`);
		}
		return Object.freeze(wrapFSImplementation(new DeviceFS(root)));
	}
	
	async makeSubRoot(folder: string): Promise<FS> {
		await this.makeFolder(folder);
		let subRoot = new DeviceFS(this.fullPath(folder));
		return Object.freeze(wrapFSImplementation(subRoot));
	}
	
	private fullPath(path: string, canBeRoot = false): string {
		return this.root + '/' + splitPathIntoParts(path, canBeRoot).join('/');
	}
	
	async statFile(path: string): Promise<FileStats> {
		let stats = await fs.stat(this.fullPath(path)).catch((e) => {
			throw maskPathInExc(this.root.length, e);
		});
		if (!stats.isFile()) { throw makeFileException(excCode.notFound,
			`Entity ${path} is not a file.`); }
		return {
			mtime: stats.atime,
			size: stats.size
		};
	}
	
	async readBytes(path: string, start?: number, end?: number):
			Promise<Uint8Array> {
		if ((typeof start === 'number') && (start < 0)) { throw new Error(
			`Parameter start has bad value: ${start}`); }
		if ((typeof end === 'number') && (end < 0)) { throw new Error(
			`Parameter end has bad value: ${end}`); }
		let fd: number = null;
		try {
			fd = await fs.open(this.fullPath(path), 'r');
			let size = (await fs.fstat(fd)).size;
			if (size === 0) { return new Uint8Array(0); }
			let buf: Buffer;
			if (typeof start !== 'number') {
				buf = new Buffer(size);
				start = 0;
			} else if (typeof end !== 'number') {
				buf = new Buffer(Math.max(0, size-start));
			} else {
				if (end > size) { end = size; }
				buf = new Buffer(Math.max(0, end-start));
			}
			if (buf.length > 0) {
				await fs.readToBuf(fd, start, buf);
			}
			return buf;
		} catch (e) {
			throw maskPathInExc(this.root.length, e);
		} finally {
			if (fd !== null) { await fs.close(fd); }
		}
	}
	
	async getByteSink(path: string, create = true, exclusive = false):
			Promise<ByteSink> {
		let pathSections = splitPathIntoParts(path);
		let pathStr = this.fullPath(path);
		let fd: number = null;
		try {
			if (create) {
				if (pathSections.length > 1) {
					let enclosingFolder = pathSections.slice(
						0, pathSections.length-1).join('/');
					await this.makeFolder(enclosingFolder);
				}
				if (exclusive) {
					fd = await fs.open(pathStr, 'wx');
				} else {
					fd = await fs.open(pathStr, 'r+')
					.catch((exc: FileException) => {
						if (exc.notFound) { return fs.open(pathStr, 'w'); }
						else { throw exc; }
					});
				}
			} else {
				fd = await fs.open(pathStr, 'r+');
			}
			let sink = syncWrapByteSink(new FileByteSink(
				pathStr, this.root.length, await fs.fstat(fd)));
			Object.freeze(sink);
			return sink;
		} catch (e) {
			throw maskPathInExc(this.root.length, e);
		} finally {
			if (fd !== null) { await fs.close(fd); }
		}
	}
	
	async getByteSource(path: string): Promise<ByteSource> {
		let pathStr = this.fullPath(path);
		let stats = await fs.stat(pathStr).catch((e) => {
			throw maskPathInExc(this.root.length, e);
		});
		let src = syncWrapByteSource(new FileByteSource(
			pathStr, this.root.length, stats));
		Object.freeze(src);
		return src;
	}
	
	async writeBytes(path: string, bytes: Uint8Array, create = true,
			exclusive = false): Promise<void> {
		let pathSections = splitPathIntoParts(path);
		let pathStr = this.fullPath(path);
		let fd: number = null;
		try {
			if (create) {
				if (pathSections.length > 1) {
					let enclosingFolder = pathSections.slice(
						0, pathSections.length-1).join('/');
					await this.makeFolder(enclosingFolder);
				} 
				fd = await fs.open(pathStr, (exclusive ? 'wx' : 'w'));
			} else {
				fd = await fs.open(pathStr, 'r+');
				await fs.ftruncate(fd, 0);
			}
			await fs.writeFromBuf(fd, 0, toBuffer(bytes));
		} catch (e) {
			throw maskPathInExc(this.root.length, e);
		} finally {
			if (fd !== null) { await fs.close(fd); }
		}
	}
	
	async deleteFile(path: string): Promise<void> {
		let pathStr = this.fullPath(path);
		await fs.unlink(pathStr)
		.catch((e: FileException) => {
			if (e.isDirectory) {
				e.notFile = true;
			}
			throw maskPathInExc(this.root.length, e);
		});
	}
	
	makeFolder(path: string, exclusive = false): Promise<void> {
		let pathSections = splitPathIntoParts(path);
		return makeFolder(this.root, pathSections, exclusive);
	}
	
	checkFolderPresence(path: string, throwIfMissing = false): Promise<boolean> {
		return checkPresence(true, this.root,
			splitPathIntoParts(path), throwIfMissing);
	}
	
	checkFilePresence(path: string, throwIfMissing = false): Promise<boolean> {
		return checkPresence(false, this.root,
			splitPathIntoParts(path), throwIfMissing);
	}
	
	async deleteFolder(path: string, removeContent = false): Promise<void> {
		let pathStr = this.fullPath(path);
		try {
			if (removeContent) {
				await fs.rmDirWithContent(pathStr);
			} else {
				await fs.rmdir(pathStr);
			}
		} catch (e) {
			throw makeFileExceptionFromNodes(e);
		}
	}
	
	async listFolder(folder: string): Promise<ListingEntry[]> {
		try {
			let pathStr = this.fullPath(folder, true);
			let listing: ListingEntry[] = [];
			for (let fName of await fs.readdir(pathStr)) {
				let stats = await fs.stat(pathStr+'/'+fName).catch((exc) => {});
				if (!stats) { continue; }
				if (stats.isFile()) {
					listing.push({
						name: fName,
						isFile: true
					});
				} else if (stats.isDirectory()) {
					listing.push({
						name: fName,
						isFolder: true
					});
				}
			}
			return listing;
		} catch (exc) {
			throw maskPathInExc(this.root.length, exc);
		}
	}
	
	async move(initPath: string, newPath: string): Promise<void> {
		let src = splitPathIntoParts(initPath);
		let dst = splitPathIntoParts(newPath);
		if (src.length === 0) { throw new Error('Invalid source path'); }
		if (dst.length === 0) { throw new Error('Invalid destination path'); }
		try {
			// check existence of source
			let srcPath = this.root+'/'+src.join('/');
			await fs.stat(srcPath);
			//ensure non-existence of destination
			let dstPath = this.root+'/'+dst.join('/');
			await fs.stat(dstPath)
			.then(() => {
				throw makeFileException(excCode.alreadyExists, `Move destination path already exists: ${newPath}`);
			}, (exc: FileException) => {
				if (!exc.notFound) { throw exc; }
			});
			// do move
			if (dst.length > 1) {
				await makeFolder(this.root, dst.slice(0, dst.length-1));
			}
			await fs.rename(srcPath, dstPath);
		} catch (e) {
			throw maskPathInExc(this.root.length, e);
		}
	}
	
}
Object.freeze(DeviceFS.prototype);
Object.freeze(DeviceFS);

Object.freeze(exports);