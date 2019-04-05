/*
 Copyright (C) 2015 - 2018 3NSoft Inc.

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
import * as pathMod from 'path';
import { watch } from 'fs';
import { makeFileException, FileException, Code as excCode, maskPathInExc }
	from '../../lib-common/exceptions/file';
import { ByteSource, ByteSink } from '../../lib-common/byte-streaming/common';
import { syncWrapByteSink, syncWrapByteSource }
	from '../../lib-common/byte-streaming/concurrent';
import { toBuffer } from '../../lib-common/buffer-utils';
import { wrapWritableFS, wrapReadonlyFS, LinkParameters, Linkable,
	wrapWritableFile, wrapReadonlyFile }
	from '../files';
import { selectInFS } from '../files-select';
import { utf8 } from '../../lib-common/buffer-utils';
import { pipe } from '../../lib-common/byte-streaming/pipe';

class FileByteSource implements ByteSource {
	
	private offset = 0;
	private size: number;
	
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
	private size: number;
	private path: string|undefined;
	
	constructor(
			path: string,
			private pathPrefixMaskLen: number,
			stat: fs.Stats) {
		this.path = path;
		this.size = stat.size;
		this.seek(0);
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
			const buf = ((bytes instanceof Buffer) ? bytes : Buffer.from(
				bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.length));
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
	const lastIndex = path.length-1;
	for (let i=0; i < path.length; i+=1) {
		pathStr += '/'+path[i];
		const stats = await fs.lstat(pathStr).catch((exc: FileException) => {
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

async function checkPresence(type: 'folder'|'file'|'link', root: string,
		path: string[], throwIfMissing: boolean): Promise<boolean> {
	try {
		const pathStr = pathMod.join(root, ...path);
		if (type === 'file') {
			const stats = await fs.lstat(pathStr);
			return stats.isFile();
		} else if (type === 'folder') {
			const stats = await fs.lstat(pathStr);
			return stats.isDirectory();
		} else if (type === 'link') {
			const pathsOnDisk = [ linkPath.make(pathStr, false),
				linkPath.make(pathStr, true), pathStr ];
			for (const p of pathsOnDisk) {
				try {
					const stats = await fs.lstat(p);
					return stats.isSymbolicLink();
				} catch (e) {
					if (p === pathStr) { throw e; }
					if ((e as FileException).notFound) { continue; }
				}
			}
			throw new Error(`Options for link's paths should be such that this line is not accessable.`);
		} else {
			throw new Error(`Unknown type ${type}`);
		}
	} catch (exc) {
		if (!throwIfMissing && (exc.code === excCode.notFound)) {
			return false;
		}
		throw maskPathInExc(root.length, exc);
	}
}

const sep = pathMod.sep;

/**
 * This function returns path split into sections. Implementation uses node's
 * path normalization. This allows to accept windows path on windows platform
 * as well as a posix path, which is what 3NStorage uses.
 * @param path
 */
function splitPathIntoParts(path: string): string[] {
	return pathMod.join(sep, path).split(sep).filter(part => (part.length > 0));
}

export type Stats = web3n.files.Stats;
export type FS = web3n.files.FS;
export type WritableFS = web3n.files.WritableFS;
export type ReadonlyFS = web3n.files.ReadonlyFS;
export type File = web3n.files.File;
export type WritableFile = web3n.files.WritableFile;
export type ReadonlyFile = web3n.files.ReadonlyFile;
export type FSType = web3n.files.FSType;
export type ListingEntry = web3n.files.ListingEntry;
export type SymLink = web3n.files.SymLink;
export type FolderEvent = web3n.files.FolderEvent;
export type FileEvent = web3n.files.FileEvent;
export type EntryAdditionEvent = web3n.files.EntryAdditionEvent;
export type EntryRemovalEvent = web3n.files.EntryRemovalEvent;
export type Observer<T> = web3n.Observer<T>;
type SelectCriteria = web3n.files.SelectCriteria;
type FSCollection = web3n.files.FSCollection;

interface FolderLinkParams {
	path: string;
}

interface FileLinkParams {
	path: string;
}

namespace linkPath {

	const wrExt = '.$writable-link$';
	const roExt = '.$readonly-link$';

	export function read(lName: string): { writable: boolean; lName: string; } {
		if (lName.endsWith(wrExt) && (lName.length > wrExt.length)) {
			return {
				lName: lName.substring(0, lName.length - wrExt.length),
				writable: true
			};
		} else if (lName.endsWith(roExt) && (lName.length > roExt.length)) {
			return {
				lName: lName.substring(0, lName.length - roExt.length),
				writable: false
			};
		} else {
			return { lName, writable: false };
		}
	}

	export function make(lName: string, writable: boolean): string {
		return `${lName}${writable ? wrExt : roExt }`;
	}

}
Object.freeze(linkPath);

type Transferable = web3n.implementation.Transferable;
type FSItem = web3n.files.FSItem;

export class DeviceFS implements WritableFS, Linkable {

	versioned: false = false;
	type: FSType = 'device';

	private constructor(
			private root: string,
			public writable: boolean,
			public name = '') {
		Object.freeze(this);
	}

	async close(): Promise<void> {}

	async getLinkParams(): Promise<LinkParameters<FolderLinkParams>> {
		const params: FolderLinkParams = {
			path: this.root
		};
		const linkParams: LinkParameters<FolderLinkParams> = {
			storageType: 'device',
			isFolder: true,
			params
		};
		if (!this.writable) {
			linkParams.readonly = true;
		}
		return linkParams;
	}

	async getLinkParamsForFile(path: string, writable: boolean): Promise<LinkParameters<FileLinkParams>> {
		const params: FileLinkParams = {
			path: this.fullPath(path)
		};
		const linkParams: LinkParameters<FileLinkParams> = {
			storageType: 'device',
			isFile: true,
			params
		};
		if (!writable) {
			linkParams.readonly = true;
		}
		return linkParams;
	}
	
	static makeFolderSymLink(fp: LinkParameters<FolderLinkParams>): SymLink {
		const path = fp.params.path;
		const readonly = !!fp.readonly;
		const sl: SymLink = {
			isFolder: true,
			readonly,
			target: () => (readonly ?
				DeviceFS.makeReadonlyFS(path) : DeviceFS.makeWritableFS(path))
		};
		(sl as any as Transferable).$_transferrable_type_id_$ = 'SimpleObject';
		return Object.freeze(sl);
	}
	
	static makeFileSymLink(fp: LinkParameters<FileLinkParams>): SymLink {
		const path = fp.params.path;
		const readonly = !!fp.readonly;
		const fName = pathMod.basename(path);
		const parentPath = pathMod.dirname(path);
		const sl: SymLink = {
			isFile: true,
			readonly,
			target: async () => {
				if (readonly) {
					const fs = await DeviceFS.makeReadonlyFS(parentPath);
					return fs.readonlyFile(fName);
				} else {
					const fs = await DeviceFS.makeWritableFS(parentPath);
					return fs.writableFile(fName);
				}
			}
		};
		(sl as any as Transferable).$_transferrable_type_id_$ = 'SimpleObject';
		return Object.freeze(sl);
	}

	static async makeWritableFS(root: string, create = false,
			exclusive = false): Promise<WritableFS> {
		await fs.lstat(root)
		.then(stat => {
			if (create && exclusive) { throw makeFileException(
				excCode.alreadyExists, root); }
			if (!stat.isDirectory()) { throw makeFileException(
				excCode.notDirectory, root); }
		}, async (e: FileException) => {
			if (!e.notFound || !create) { throw maskPathInExc(0, e); }
			await fs.mkdir(root);
		});
		const folderName = pathMod.basename(root);
		return DeviceFS.makeAndWrapWrFS(root, folderName);
	}

	private static makeAndWrapWrFS(root: string, name: string): WritableFS {
		const wrFS = wrapWritableFS(new DeviceFS(root, true, name));
		DeviceFS.itemToPathMap.set(wrFS, root);
		return wrFS;
	}

	private static makeAndWrapRoFS(root: string, name: string): ReadonlyFS {
		const roFS = wrapReadonlyFS(new DeviceFS(root, false, name));
		DeviceFS.itemToPathMap.set(roFS, root);
		return roFS;
	}

	static async makeReadonlyFS(root: string): Promise<ReadonlyFS> {
		await checkFolderPresence(root);
		const folderName = pathMod.basename(root);
		return DeviceFS.makeAndWrapRoFS(root, folderName);
	}

	static async makeFSItemFor(path: string, writable: boolean):
			Promise<FSItem> {
		const stats = await fs.stat(path)
		.catch((e: FileException) => {
			throw maskPathInExc(0, e);
		});
		if (stats.isDirectory()) {
			const fsItem: FSItem = {
				isFolder: true,
				item: await (writable ?
					DeviceFS.makeWritableFS(path) :
					DeviceFS.makeReadonlyFS(path))
			}
			return fsItem;
		} else if (stats.isFile()) {
			const parentPath = pathMod.dirname(path);
			const fileName = pathMod.basename(path);
			let file: File;
			if (writable) {
				const parent = await DeviceFS.makeWritableFS(parentPath);
				file = await parent.writableFile(fileName);
			} else {
				const parent = await DeviceFS.makeReadonlyFS(parentPath)
				file = await parent.readonlyFile(fileName);
			}
			const fsItem: FSItem = {
				isFile: true,
				item: file
			};
			return fsItem;
		} else {
			throw makeFileException(excCode.notFile, path);
		}
	}
	
	async readonlySubRoot(folder: string): Promise<ReadonlyFS> {
		await this.checkFolderPresence(folder, true);
		const folderName = pathMod.basename(folder);
		const subRootPath = this.fullPath(folder, true);
		return DeviceFS.makeAndWrapRoFS(subRootPath, folderName);
	}

	async writableSubRoot(folder: string, create = true, exclusive = false):
			Promise<WritableFS> {
		if (create) {
			await this.makeFolder(folder, exclusive);
		} else {
			await this.checkFolderPresence(folder, true);
		}
		const folderName = pathMod.basename(folder);
		const subRootPath = this.fullPath(folder, true);
		return DeviceFS.makeAndWrapWrFS(subRootPath, folderName);
	}
	
	/**
	 * This returns a full path on device. If it is windows (non-posix),
	 * windows path is returned.
	 * @param path is what used in 3NWeb, i.e. posix path. When on windows, path
	 * can also be a windows path, and this method adjusts accordingly to join
	 * given path to root path.
	 * @param canBeRoot 
	 */
	private fullPath(path: string, canBeRoot = false): string {
		return pathUnderRoot(this.root, path, canBeRoot);
	}
	
	async stat(path: string): Promise<Stats> {
		const stats = await fs.lstat(this.fullPath(path)).catch((e) => {
			throw maskPathInExc(this.root.length, e);
		});
		if (stats.isFile()) {
			return {
				isFile: true,
				writable: this.writable,
				mtime: stats.mtime,
				atime: stats.atime,
				ctime: stats.ctime,
				size: stats.size
			};
		} else if (stats.isDirectory()) {
			return {
				isFolder: true,
				writable: this.writable,
				mtime: stats.mtime,
				atime: stats.atime,
				ctime: stats.ctime,
			};
		} else if (stats.isSymbolicLink()) {
			return {
				isLink: true,
				writable: false,
				mtime: stats.mtime,
				atime: stats.atime,
				ctime: stats.ctime,
			};
		} else {
			throw new Error(`File system element has device-specific type.`);
		}
	}

	select(path: string, criteria: SelectCriteria):
			Promise<{ items: FSCollection; completion: Promise<void>; }> {
		return selectInFS(this, path, criteria);
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
			const size = (await fs.fstat(fd)).size;
			if (size === 0) { return; }
			if (typeof start !== 'number') {
				start = 0;
				end = size;
			} else if ((typeof end !== 'number') || (size < end)) {
				end = size;
			}
			if ((end - start) < 1) { return; }
			const bytes = new Buffer(end - start);
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
		const pathSections = splitPathIntoParts(path);
		const pathStr = this.fullPath(path);
		let fd: number|undefined = undefined;
		try {
			if (create) {
				if (pathSections.length > 1) {
					const enclosingFolder = pathSections.slice(
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
			const sink = syncWrapByteSink(new FileByteSink(
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
		const pathStr = this.fullPath(path);
		const stats = await fs.lstat(pathStr).catch((e) => {
			throw maskPathInExc(this.root.length, e);
		});
		const src = syncWrapByteSource(new FileByteSource(
			pathStr, this.root.length, stats));
		Object.freeze(src);
		return src;
	}
	
	async writeBytes(path: string, bytes: Uint8Array, create = true,
			exclusive = false): Promise<void> {
		const pathSections = splitPathIntoParts(path);
		const pathStr = this.fullPath(path);
		let fd: number|undefined = undefined;
		try {
			if (create) {
				if (pathSections.length > 1) {
					const enclosingFolder = pathSections.slice(
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

	writeTxtFile(path: string, txt: string, create = true, exclusive = false):
			Promise<void> {
		const bytes = utf8.pack(txt);
		return this.writeBytes(path, bytes, create, exclusive);
	}
	
	async readTxtFile(path: string): Promise<string> {
		const bytes = await this.readBytes(path);
		try {
			const txt = (bytes ? utf8.open(bytes) : '');
			return txt;
		} catch (err) {
			throw makeFileException(excCode.parsingError, path, err);
		}
	}
	
	writeJSONFile(path: string, json: any, create = true, exclusive = false):
			Promise<void> {
		const txt = JSON.stringify(json);
		return this.writeTxtFile(path, txt, create, exclusive);
	}

	async readJSONFile<T>(path: string): Promise<T> {
		const txt = await this.readTxtFile(path);
		try {
			const json = JSON.parse(txt);
			return json;
		} catch (err) {
			throw makeFileException(excCode.parsingError, path, err);
		}
	}
	
	async deleteFile(path: string): Promise<void> {
		const pathStr = this.fullPath(path);
		await fs.unlink(pathStr)
		.catch((e: FileException) => {
			if (e.isDirectory) {
				e.notFile = true;
			}
			throw maskPathInExc(this.root.length, e);
		});
	}
	
	makeFolder(path: string, exclusive = false): Promise<void> {
		const pathSections = splitPathIntoParts(path);
		return makeFolder(this.root, pathSections, exclusive);
	}
	
	checkFolderPresence(path: string, throwIfMissing = false): Promise<boolean> {
		return checkPresence('folder', this.root,
			splitPathIntoParts(path), throwIfMissing);
	}
	
	checkFilePresence(path: string, throwIfMissing = false): Promise<boolean> {
		return checkPresence('file', this.root,
			splitPathIntoParts(path), throwIfMissing);
	}
	
	async deleteFolder(path: string, removeContent = false): Promise<void> {
		const pathStr = this.fullPath(path);
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
			const pathStr = this.fullPath(folder, true);
			const lst: ListingEntry[] = [];
			for (const fName of await fs.readdir(pathStr)) {
				const stats = await fs.lstat(pathStr+'/'+fName).catch(() => {});
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
				} else if (stats.isSymbolicLink()) {
					lst.push({
						name: linkPath.read(fName).lName,
						isLink: true
					});
				}
			}
			return lst;
		} catch (exc) {
			throw maskPathInExc(this.root.length, exc);
		}
	}
	
	async move(initPath: string, newPath: string): Promise<void> {
		const src = splitPathIntoParts(initPath);
		const dst = splitPathIntoParts(newPath);
		if (src.length === 0) { throw new Error('Invalid source path'); }
		if (dst.length === 0) { throw new Error('Invalid destination path'); }
		try {
			// check existence of source
			const srcPath = this.root+'/'+src.join('/');
			await fs.lstat(srcPath);
			//ensure non-existence of destination
			const dstPath = this.root+'/'+dst.join('/');
			await fs.lstat(dstPath)
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

	checkLinkPresence(path: string, throwIfMissing = true): Promise<boolean> {
		return checkPresence('link', this.root,
			splitPathIntoParts(path), throwIfMissing);
	}
	
	async deleteLink(path: string): Promise<void> {
		path = this.fullPath(path);
		const pathsOnDisk = [ linkPath.make(path, false),
			linkPath.make(path, true), path ];
		let err: FileException|undefined = undefined;
		for (const p of pathsOnDisk) {
			try {
				await fs.unlink(p);
				err = undefined;
				break;
			} catch (e) {
				err = e;
			}
		}
		if (err) {
			if (err.isDirectory) {
				err.notLink = true;
			}
			throw maskPathInExc(this.root.length, err);
		}
	}

	async readLink(path: string): Promise<SymLink> {
		try {
			path = this.fullPath(path);
			const pathsOnDisk = [ linkPath.make(path, false),
				linkPath.make(path, true), path ];
			let targetPath: string|undefined = undefined;
			let writable = false;
			for (const p of pathsOnDisk) {
				try {
					targetPath = await fs.readlink(p);
					writable = linkPath.read(p).writable;
					break;
				} catch (e) {
					if (p === path) { throw e; }
					if ((e as FileException).notFound) { continue; }
				}
			}
			if (!targetPath) { throw new Error(
				`Options for link's paths should be such that this line is not accessable.`); }
			const stat = await fs.lstat(targetPath);
			if (stat.isFile()) {
				const fp: LinkParameters<FileLinkParams> = {
					isFile: true,
					storageType: 'device',
					readonly: !writable,
					params: {
						path: targetPath,
					}
				};
				return DeviceFS.makeFileSymLink(fp);
			} else if (stat.isDirectory()) {
				const fp: LinkParameters<FolderLinkParams> = {
					isFolder: true,
					storageType: 'device',
					readonly: !writable,
					params: {
						path: targetPath,
					}
				};
				return DeviceFS.makeFolderSymLink(fp);
			} else {
				throw new Error(`Link points to neither file, nor folder`);
			}
		} catch (e) {
			throw maskPathInExc(this.root.length, e);
		}
	}
	
	async link(path: string, target: File | FS): Promise<void> {
		// do sanity checks
		if (!target ||
				(typeof (<Linkable> <any> target).getLinkParams !== 'function')) {
			throw new Error('Given target is not-linkable');
		}
		const params = await (target as any as Linkable).getLinkParams();
		// note, we could check (params.storageType !== 'device'), but, since we
		// also use this implementation for mocking, we do params matching instead
		if (typeof params.params.path !== 'string') {
			throw new Error(`Cannot create link to ${params.storageType} from ${this.type} storage.`);
		}

		// ensure presence of folder in which link is made
		const pathSections = splitPathIntoParts(path);
		if (pathSections.length > 1) {
			const enclosingFolder = pathSections.slice(
				0, pathSections.length-1).join('/');
			await this.makeFolder(enclosingFolder);
		}

		// create native symlink
		if (params.isFile) {
			const p = (params as LinkParameters<FileLinkParams>).params;
			await fs.symlink(p.path,
				linkPath.make(this.fullPath(path), !params.readonly));
		} else if (params.isFolder) {
			const p = (params as LinkParameters<FolderLinkParams>).params;
			await fs.symlink(p.path,
				linkPath.make(this.fullPath(path), !params.readonly));
		} else {
			throw new Error('Generated link params are for neither file, nor folder');
		}
	}

	private static itemToPathMap = new WeakMap<FS|File, string>();
	
	static getPath(pathOrFile: File|string, fs?: FS): string|undefined {
		if (!fs) { return this.itemToPathMap.get(pathOrFile as File); }
		const fsPath = this.itemToPathMap.get(fs);
		if (fsPath === undefined) { return; }
		return ((typeof fsPath === 'string') ?
			pathUnderRoot(fsPath, pathOrFile as string, true) : undefined);
	}

	async readonlyFile(path: string): Promise<ReadonlyFile> {
		await this.checkFilePresence(path, true);
		const filePath = this.fullPath(path);
		const roF = wrapReadonlyFile(new FileObject(this, path, true, false));
		DeviceFS.itemToPathMap.set(roF, filePath);
		return roF;
	}

	async writableFile(path: string, create = true, exclusive = false):
			Promise<WritableFile> {
		const exists = await this.checkFilePresence(path);
		if (exists && create && exclusive) { throw makeFileException(
			excCode.alreadyExists, path); }
		if (!exists && !create) { throw makeFileException(
			excCode.notFound, path); }
		const filePath = this.fullPath(path);
		const wrF = wrapWritableFile(new FileObject(this, path, exists, true));
		DeviceFS.itemToPathMap.set(wrF, filePath);
		return wrF;
	}

	watchFolder(path: string, observer: Observer<FolderEvent>): () => void {
		const fullFolderPath = this.fullPath(path, true);
		let watcher = watch(fullFolderPath);
		if (observer.next) {
			watcher.on('change', (fsEvent, name: string) => {
				if (fsEvent !== 'rename') { return; }
				fs.stat(`${fullFolderPath}/${name}`).then(stat => {
					if (!observer) { return; }
					let entry: ListingEntry;
					if (stat.isFile()) {
						entry = { name, isFile: true };
					} else if (stat.isDirectory()) {
						entry = { name, isFolder: true };
					} else if (stat.isSymbolicLink()) {
						entry = { name, isLink: true };
					} else {
						return;
					}
					const folderEvent: EntryAdditionEvent = {
						type: 'entry-addition',
						path,
						entry
					};
					observer.next!(folderEvent);
				}, (err: FileException) => {
					if (!observer) { return; }
					if (err.notFound) {
						const folderEvent: EntryRemovalEvent = {
							type: 'entry-removal',
							path,
							name
						};
						observer.next!(folderEvent);
						return;
					}
					try {
						if (observer.error) {
							observer.error(maskPathInExc(this.root.length, err));
						} else if (observer.complete) {
							observer.complete();
						}
					} finally {
						detach();
					}
				});
			});
		}
		watcher.on('error', (code, sig) => {
			if (!observer) { return; }
			try {
				if (observer.error) {
					observer.error(makeFileException(sig, path, { code, sig }));
				} else if (observer.complete) {
					observer.complete();
				}
			} finally {
				detach();
			}
		});
		const detach = () => {
			if (!watcher) { return; }
			watcher.close();
			watcher = undefined as any;
			observer = undefined as any;
		}
		return detach;
	}

	watchFile(path: string, observer: Observer<FileEvent>): () => void {
		throw new Error('Not implemented, yet');
	}

	watchTree(path: string, observer: Observer<FolderEvent|FileEvent>):
			() => void {
		throw new Error('Not implemented, yet');
	}

	async copyFile(src: string, dst: string, overwrite = false): Promise<void> {
		const srcBytes = await this.getByteSource(src);
		const sink = await this.getByteSink(dst, true, !overwrite);
		await pipe(srcBytes, sink);
	}

	async copyFolder(src: string, dst: string, mergeAndOverwrite = false):
			Promise<void> {
		const list = await this.listFolder(src);
		await this.makeFolder(dst, !mergeAndOverwrite);
		for (const f of list) {
			if (f.isFile) {
				await this.copyFile(`${src}/${f.name}`, `${dst}/${f.name}`,
					mergeAndOverwrite);
			} else if (f.isFolder) {
				await this.copyFolder(`${src}/${f.name}`, `${dst}/${f.name}`,
					mergeAndOverwrite);
			} else if (f.isLink) {
				throw new Error('This implementation cannot copy links');
			}
		}
	}

	async saveFile(file: File, dst: string, overwrite = false): Promise<void> {
		const src = await file.getByteSource();
		const sink = await this.getByteSink(dst, true, !overwrite);
		await pipe(src, sink);
	}

	async saveFolder(folder: FS, dst: string, mergeAndOverwrite = false):
			Promise<void> {
		const lst = await folder.listFolder('/');
		await this.makeFolder(dst, !mergeAndOverwrite);
		for (const f of lst) {
			if (f.isFile) {
				const src = await folder.getByteSource(f.name);
				const sink = await this.getByteSink(
					`${dst}/${f.name}`, true, !mergeAndOverwrite);
				await pipe(src, sink);
			} else if (f.isFolder) {
				const subFolder = await folder.readonlySubRoot(f.name);
				await this.saveFolder(subFolder, `${dst}/${f.name}`,
					mergeAndOverwrite);
			} else if (f.isLink) {
				throw new Error('This implementation cannot copy links');
			}
		}
	}

}
Object.freeze(DeviceFS.prototype);
Object.freeze(DeviceFS);

/**
 * This returns a full path on device. If it is windows (non-posix),
 * windows path is returned.
 * @param root
 * @param path is what used in 3NWeb, i.e. posix path. When on windows, path
 * can also be a windows path, and this method adjusts accordingly to join
 * given path to root path.
 * @param canBeRoot 
 */
function pathUnderRoot(root: string, path: string, canBeRoot = false): string {
	path = pathMod.join(sep, path);
	if ((path === sep) && !canBeRoot) { throw new Error(
		`Given path incorrectly points to root: ${path}`); }
	return pathMod.join(root, path);
}

async function checkFolderPresence(path: string): Promise<void> {
	const stat = await fs.lstat(path).catch((e) => {
		throw maskPathInExc(0, e);
	});
	if (!stat.isDirectory()) {
		throw makeFileException(excCode.notDirectory, path);
	}
}

class FileObject implements WritableFile, Linkable {

	public versioned: false = false;

	public name: string;

	public isNew: boolean;

	private pathPrefixMaskLen: number;

	constructor(private fs: DeviceFS,
			private path: string,
			private exists: boolean,
			public writable: boolean) {
		this.name = pathMod.basename(this.path);
		this.isNew = !exists;
		this.pathPrefixMaskLen = this.path.length - this.name.length;
		if (this.writable && !this.fs.writable) { throw new Error(
			`Cannot create writable file in a readonly file system.`); }
		Object.seal(this);
	}

	async getLinkParams(): Promise<LinkParameters<FileLinkParams>> {
		return this.fs.getLinkParamsForFile(this.path, this.writable);
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

	stat(): Promise<Stats> {
		try {
			return this.fs.stat(this.path);
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}

	async copy(file: web3n.files.File): Promise<void> {
		const sink = await this.getByteSink();
		const src = await file.getByteSource();
		await pipe(src, sink);
	}

	watch(observer: Observer<FileEvent>): () => void {
		return this.fs.watchFile(this.path, observer);
	}	

}
Object.freeze(FileObject.prototype);
Object.freeze(FileObject);

Object.freeze(exports);