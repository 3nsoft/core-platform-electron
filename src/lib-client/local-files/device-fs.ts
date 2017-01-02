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
import { makeFileException, FileException, Code as excCode, maskPathInExc }
	from '../../lib-common/exceptions/file';
import { ByteSource, ByteSink } from '../../lib-common/byte-streaming/common';
import { syncWrapByteSink, syncWrapByteSource }
	from '../../lib-common/byte-streaming/concurrent';
import { toBuffer } from '../../lib-common/buffer-utils';
import { splitPathIntoParts, AbstractFS, wrapFSImplementation, LinkParameters,
	File, Linkable, wrapFileImplementation, FS }
	from '../files';
import { basename, dirname } from 'path';
import { utf8 } from '../../lib-common/buffer-utils';
import { pipe } from '../../lib-common/byte-streaming/pipe';

export { pathStaysWithinItsRoot } from '../files';

class FileByteSource implements ByteSource {
	
	private offset = 0;
	private size: number|undefined = undefined;
	
	constructor(
			private path: string,
			private pathPrefixMaskLen: number,
			stat: fs.Stats) {
		this.size = stat.size;
		Object.seal(this);
	}
	
	async getSize(): Promise<number|undefined> {
		return this.size;
	}
	
	async read(len: number): Promise<Uint8Array|undefined> {
		if (this.offset >= this.size) { return; }
		let fd: number|undefined = undefined;
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
			if (fd !== undefined) { await fs.close(fd); }
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
	private size: number|undefined = undefined;
	private path: string|undefined;
	
	constructor(
			path: string,
			private pathPrefixMaskLen: number,
			stat: fs.Stats) {
		this.path = path;
		this.seek(0);
		this.size = stat.size;
		Object.seal(this);
	}
	
	async write(bytes: Uint8Array|null, err?: any): Promise<void> {
		if (!this.path) { return; }
		if (err || (bytes === null)) {
			this.path = undefined;
			return;
		}
		if (bytes.length === 0) { return; }
		let fd: number|undefined = undefined;
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
			if (fd !== undefined) { await fs.close(fd); }
		}
	}
	
	async setSize(size: number): Promise<void> {
		if (!this.path) { throw new Error('Cannot set size of a closed sink.'); }
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
	
	async getSize(): Promise<number|undefined> {
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
				path.slice(0, i+1).join('/'));
		} else if ((i === lastIndex) && exclusive) {
			throw makeFileException(excCode.alreadyExists, path.join('/'));
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

export type FileStats = web3n.files.FileStats;
export type FS = web3n.files.FS;
export type ListingEntry = web3n.files.ListingEntry;

interface FolderLinkParams {
	folderName: string;
	path: string;
}

interface FileLinkParams {
	fileName: string;
	path: string;
}

type SymLink = web3n.storage.SymLink;

export class DeviceFS extends AbstractFS implements FS {
	
	constructor(
			private root: string,
			writable: boolean,
			folderName?: string) {
		super(folderName!, writable, false);
		Object.freeze(this);
	}

	async getLinkParams(): Promise<LinkParameters<FolderLinkParams>> {
		let params: FolderLinkParams = {
			folderName: this.name,
			path: this.root
		};
		let linkParams: LinkParameters<FolderLinkParams> = {
			storageType: 'device',
			isFolder: true,
			params
		};
		return linkParams;
	}

	async getLinkParamsForFile(path: string, fileName: string,
			writable: boolean): Promise<LinkParameters<FileLinkParams>> {
		let params: FileLinkParams = {
			fileName: fileName,
			path: this.fullPath(path)
		};
		let linkParams: LinkParameters<FileLinkParams> = {
			storageType: 'device',
			isFile: true,
			params
		};
		return linkParams;
	}
	
	static makeFolderSymLink(fp: LinkParameters<FolderLinkParams>): SymLink {
		let path = fp.params.folderName;
		let readonly = fp.readonly;
		let sl: SymLink = {
			isFolder: true,
			readonly: !!readonly,
			target: () => DeviceFS.make(path, !readonly)
		};
		return Object.freeze(sl);
	}
	
	static makeFileSymLink(fp: LinkParameters<FileLinkParams>): SymLink {
		let path = fp.params.fileName;
		let readonly = !!fp.readonly;
		let fName = basename(path);
		let parentPath = dirname(path);
		let sl: SymLink = {
			isFolder: true,
			readonly,
			target: async (): Promise<File> => {
				let fs = await DeviceFS.make(parentPath, !readonly);
				return (readonly ?
					fs.readonlyFile(fName) : fs.writableFile(fName));
			}
		};
		return Object.freeze(sl);
	}

	static async make(root: string, writable = true): Promise<FS> {
		let stat = await fs.stat(root).catch((e) => {
			throw maskPathInExc(0, e);
		});
		if (!stat.isDirectory()) {
			throw makeFileException(excCode.notDirectory, root);
		}
		return Object.freeze(wrapFSImplementation(new DeviceFS(root, writable)));
	}
	
	private async makeSubRoot(writable: boolean, folder: string,
			folderName?: string): Promise<FS> {
		if (writable) {
			await this.makeFolder(folder);
		} else {
			await this.checkFolderPresence(folder, true);
		}
		if (folderName === undefined) {
			let slashInd = folder.lastIndexOf('/');
			folderName = ((slashInd < 0) ?
				(undefined as any) : folder.substring(slashInd+1));
		}
		let subRoot = new DeviceFS(this.fullPath(folder, true),
			writable, folderName);
		return Object.freeze(wrapFSImplementation(subRoot));
	}

	readonlySubRoot(folder: string, folderName?: string): Promise<FS> {
		return this.makeSubRoot(false, folder, folderName);
	}

	writableSubRoot(folder: string, folderName?: string): Promise<FS> {
		return this.makeSubRoot(true, folder, folderName);
	}
	
	private fullPath(path: string, canBeRoot = false): string {
		return this.root + '/' + splitPathIntoParts(path, canBeRoot).join('/');
	}
	
	async statFile(path: string): Promise<FileStats> {
		let stats = await fs.stat(this.fullPath(path)).catch((e) => {
			throw maskPathInExc(this.root.length, e);
		});
		if (!stats.isFile()) { throw makeFileException(excCode.notFound, path); }
		return {
			mtime: stats.atime,
			size: stats.size
		};
	}
	
	async readBytes(path: string, start?: number, end?: number):
			Promise<Uint8Array|undefined> {
		if ((typeof start === 'number') && (start < 0)) { throw new Error(
			`Parameter start has bad value: ${start}`); }
		if ((typeof end === 'number') && (end < 0)) { throw new Error(
			`Parameter end has bad value: ${end}`); }
		let fd: number|undefined = undefined;
		try {
			fd = await fs.open(this.fullPath(path), 'r');
			let size = (await fs.fstat(fd)).size;
			if (size === 0) { return; }
			if (typeof start !== 'number') {
				start = 0;
				end = size;
			} else if ((typeof end !== 'number') || (size < end)) {
				end = size;
			}
			if ((end - start) < 1) { return; }
			let bytes = new Buffer(end - start);
			await fs.readToBuf(fd, start, bytes);
			return bytes;
		} catch (e) {
			throw maskPathInExc(this.root.length, e);
		} finally {
			if (fd !== undefined) { await fs.close(fd); }
		}
	}
	
	async getByteSink(path: string, create = true, exclusive = false):
			Promise<web3n.ByteSink> {
		let pathSections = splitPathIntoParts(path);
		let pathStr = this.fullPath(path);
		let fd: number|undefined = undefined;
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
			if (fd !== undefined) { await fs.close(fd); }
		}
	}
	
	async getByteSource(path: string): Promise<web3n.ByteSource> {
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
		let fd: number|undefined = undefined;
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
			if (fd !== undefined) { await fs.close(fd); }
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
			throw maskPathInExc(this.root.length, e);
		}
	}
	
	async listFolder(folder: string): Promise<ListingEntry[]> {
		try {
			let pathStr = this.fullPath(folder, true);
			let lst: ListingEntry[] = [];
			for (let fName of await fs.readdir(pathStr)) {
				let stats = await fs.stat(pathStr+'/'+fName).catch((exc) => {});
				if (!stats) { continue; }
				if (stats.isFile()) {
					lst.push({
						name: fName,
						isFile: true
					});
				} else if (stats.isDirectory()) {
					lst.push({
						name: fName,
						isFolder: true
					});
				}
			}
			return lst;
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
				throw makeFileException(excCode.alreadyExists, newPath);
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
	
	protected async makeFileObject(path: string, exists: boolean,
			writable: boolean): Promise<File> {
		let f = new FileObject(this, path, exists, writable);
		return wrapFileImplementation(f);
	}
	
}
Object.freeze(DeviceFS.prototype);
Object.freeze(DeviceFS);

class FileObject implements File, Linkable {

	public versioned = false;

	public name: string;

	public isNew: boolean;

	private pathPrefixMaskLen: number;

	constructor(private fs: DeviceFS,
			private path: string,
			private exists: boolean,
			public writable: boolean) {
		this.name = basename(this.path);
		this.isNew = !exists;
		this.pathPrefixMaskLen = this.path.length - this.name.length;
		Object.seal(this);
	}

	async getLinkParams(): Promise<LinkParameters<FileLinkParams>> {
		return this.fs.getLinkParamsForFile(
			this.path, this.name, this.writable);
	}

	async writeBytes(bytes: Uint8Array): Promise<void> {
		try {
			await this.fs.writeBytes(this.path, bytes);
			this.exists = true;
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}

	async writeJSON(json: any): Promise<void> {
		try {
			await this.fs.writeJSONFile(this.path, json);
			this.exists = true;
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}

	async writeTxt(txt: string): Promise<void> {
		try {
			await this.fs.writeTxtFile(this.path, txt);
			this.exists = true;
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}

	readBytes(start?: number, end?: number):
			Promise<Uint8Array|undefined> {
		try {
			return this.fs.readBytes(this.path, start, end);
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}

	readTxt(): Promise<string> {
		try {
			return this.fs.readTxtFile(this.path);
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}

	readJSON<T>(): Promise<T> {
		try {
			return this.fs.readJSONFile<T>(this.path);
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}

	getByteSink(): Promise<web3n.ByteSink> {
		try {
			return this.fs.getByteSink(
				this.path, !this.exists, !this.exists);
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}
	
	getByteSource(): Promise<web3n.ByteSource> {
		try {
			return this.fs.getByteSource(this.path);
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}

	stat(): Promise<FileStats> {
		try {
			return this.fs.statFile(this.path);
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}

	async copy(file: web3n.files.File): Promise<void> {
		let sink = await this.getByteSink();
		let src = await file.getByteSource();
		await pipe(src, sink);
	}

}
Object.freeze(FileObject.prototype);
Object.freeze(FileObject);

Object.freeze(exports);