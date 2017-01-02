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

import { bind } from '../lib-common/binding';
import { basename } from 'path';
import { makeFileException, Code as excCode }
	from '../lib-common/exceptions/file';
import { pipe } from '../lib-common/byte-streaming/pipe';
import { utf8 } from '../lib-common/buffer-utils';

export function splitPathIntoParts(path: string, canBeEmpty = false): string[] {
	let pathParts = (path ? path.split('/') : []);
	for (let i=0; i < pathParts.length; i+=1) {
		let part = pathParts[i];
		if ((part.length === 0) || (part === '.')) {
			pathParts.splice(i, 1);
			i -= 1;
		} else if (part === '..') {
			if (i === 0) {
				pathParts.splice(i, 1);
				i -= 1;
			} else {
				pathParts.splice(i-1, 2);
				i -= 2;
			}
		}
	}
	if ((pathParts.length === 0) && !canBeEmpty) { throw new Error(
		`Given path incorrectly points to root: ${path}`); }
	return pathParts;
}

/**
 * @param path string that needs to be sanitized by containing it to its root
 * @return a given path, contained to its root, by properly changing '..'s and
 * and removing them at a root position.
 */
export function containPathWithinItsRoot(path: string): string {
	return splitPathIntoParts(path, true).join('/');
}

/**
 * @param path string that needs to be analyzed for, whether it points to
 * something within its root, or outside.
 * @return true, if given path points to something within the root, and false,
 * if given path points outside of the root.
 */
export function pathStaysWithinItsRoot(path: string): boolean {
	let pathParts = (path ? path.split('/') : []);
	for (let i=0; i < pathParts.length; i+=1) {
		let part = pathParts[i];
		if ((part.length === 0) || (part === '.')) {
			pathParts.splice(i, 1);
			i -= 1;
		} else if (part === '..') {
			if (i === 0) {
				return false;
			} else {
				pathParts.splice(i-1, 2);
				i -= 2;
			}
		}
	}
	return true;
}

export type FileStats = web3n.files.FileStats;
export type FS = web3n.files.FS;
export type File = web3n.files.File;
export type ListingEntry = web3n.files.ListingEntry;
export type ByteSink = web3n.ByteSink;
export type ByteSource = web3n.ByteSource;

export type StorageType = 'device' | 'synced' | 'local' |
	'share' | 'asmail-msg';

export interface LinkParameters<T> {
	storageType: StorageType;
	readonly?: boolean;
	isFolder?: boolean;
	isFile?: boolean;
	params: T;
}

/**
 * This interface is applicable to core-side FS and File objects.
 */
export interface Linkable {
	getLinkParams(): Promise<LinkParameters<any>>;
}

export abstract class AbstractFS implements Linkable {
	
	constructor(
		public name: string,
		public writable: boolean,
		public versioned: boolean) {}

	abstract getLinkParams(): Promise<LinkParameters<any>>;

	abstract getByteSink(path: string, create?: boolean, exclusive?: boolean):
		Promise<ByteSink>;
	
	abstract getByteSource(path: string):
		Promise<ByteSource>;
	
	abstract deleteFile(path: string): Promise<void>;
	
	abstract makeFolder(path: string, exclusive?: boolean): Promise<void>;
	
	abstract checkFilePresence(path: string, throwIfMissing?: boolean):
			Promise<boolean>;
	
	abstract listFolder(folder: string): Promise<ListingEntry[]>;
	
	abstract move(initPath: string, newPath: string): Promise<void>;

	abstract writeBytes(path: string, bytes: Uint8Array, create?: boolean,
			exclusive?: boolean): Promise<void>;

	abstract readBytes(path: string, start?: number, end?: number):
			Promise<Uint8Array|undefined>;

	writeTxtFile(path: string, txt: string, create = true, exclusive = false):
			Promise<void> {
		let bytes = utf8.pack(txt);
		return this.writeBytes(path, bytes, create, exclusive);
	}
	
	async readTxtFile(path: string): Promise<string> {
		let bytes = await this.readBytes(path);
		let txt = (bytes ? utf8.open(bytes) : '');
		return txt;
	}
	
	writeJSONFile(path: string, json: any, create = true, exclusive = false):
			Promise<void> {
		let txt = JSON.stringify(json);
		return this.writeTxtFile(path, txt, create, exclusive);
	}

	async readJSONFile<T>(path: string): Promise<T> {
		let txt = await this.readTxtFile(path);
		let json = JSON.parse(txt);
		return json;
	}

	async copyFile(src: string, dst: string, overwrite = false): Promise<void> {
		let srcBytes = await this.getByteSource(src);
		let sink = await this.getByteSink(dst, true, !overwrite);
		await pipe(srcBytes, sink);
	}

	async copyFolder(src: string, dst: string, mergeAndOverwrite = false):
			Promise<void> {
		let list = await this.listFolder(src);
		await this.makeFolder(dst, !mergeAndOverwrite);
		for (let f of list) {
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

	async readonlyFile(path: string): Promise<File> {
		await this.checkFilePresence(path, true);
		return this.makeFileObject(path, true, false);
	}

	async writableFile(path: string, create = true, exclusive = false):
			Promise<File> {
		let exists = await this.checkFilePresence(path);
		if (exists && create && exclusive) { throw makeFileException(
			excCode.alreadyExists, path); }
		if (!exists && !create) { throw makeFileException(
			excCode.notFound, path); }
		return this.makeFileObject(path, exists, true);
	}

	async saveFile(file: File, dst: string, overwrite = false): Promise<void> {
		let src = await file.getByteSource();
		let sink = await this.getByteSink(dst, true, !overwrite);
		await pipe(src, sink);
	}

	async saveFolder(folder: FS, dst: string, mergeAndOverwrite = false):
			Promise<void> {
		let lst = await folder.listFolder('/');
		await this.makeFolder(dst, !mergeAndOverwrite);
		for (let f of lst) {
			if (f.isFile) {
				let src = await folder.getByteSource(f.name);
				let sink = await this.getByteSink(
					`${dst}/${f.name}`, true, !mergeAndOverwrite);
				await pipe(src, sink);
			} else if (f.isFolder) {
				let subFolder = await folder.readonlySubRoot(f.name);
				await this.saveFolder(subFolder, `${dst}/${f.name}`,
					mergeAndOverwrite);
			} else if (f.isLink) {
				throw new Error('This implementation cannot copy links');
			}
		}
	}

	protected abstract makeFileObject(path: string,
		exists: boolean, writable: boolean): Promise<File>;

	async close(): Promise<void> {}

}

export function throwFileReadonlyExc(): never {
	throw new Error(`File is readonly, and writing methods are not available`);
}

export function wrapFileImplementation(fImpl: File): File {
	let w: File = {
		versioned: fImpl.versioned,
		writable: fImpl.writable,
		isNew: fImpl.isNew,
		name: fImpl.name,
		getByteSource: bind(fImpl, fImpl.getByteSource),
		readJSON: bind(fImpl, fImpl.readJSON),
		readTxt: bind(fImpl, fImpl.readTxt),
		readBytes: bind(fImpl, fImpl.readBytes),
		stat: bind(fImpl, fImpl.stat),
		getByteSink: ((fImpl.writable) ?
			bind(fImpl, fImpl.getByteSink) : throwFileReadonlyExc),
		writeJSON: ((fImpl.writable) ?
			bind(fImpl, fImpl.writeJSON) : throwFileReadonlyExc),
		writeTxt: ((fImpl.writable) ?
			bind(fImpl, fImpl.writeTxt) : throwFileReadonlyExc),
		writeBytes: ((fImpl.writable) ?
			bind(fImpl, fImpl.writeBytes) : throwFileReadonlyExc),
		copy: ((fImpl.writable) ?
			bind(fImpl, fImpl.copy) : throwFileReadonlyExc)
	};
	(<Linkable> <any> w).getLinkParams =
		bind(fImpl, (<Linkable> <any> fImpl).getLinkParams);
	return w;
}

export function throwFSReadonlyExc(): never {
	throw new Error(`File system is readonly, and writing methods are not available`);
}

export function wrapFSImplementation(fsImpl: FS): FS {
	let w: FS = {
		versioned: fsImpl.versioned,
		writable: fsImpl.writable,
		name: fsImpl.name,
		getByteSource: bind(fsImpl, fsImpl.getByteSource),
		readBytes: bind(fsImpl, fsImpl.readBytes),
		readTxtFile: bind(fsImpl, fsImpl.readTxtFile),
		readJSONFile: bind(fsImpl, fsImpl.readJSONFile),
		listFolder: bind(fsImpl, fsImpl.listFolder),
		checkFolderPresence: bind(fsImpl, fsImpl.checkFolderPresence),
		checkFilePresence: bind(fsImpl, fsImpl.checkFilePresence),
		statFile: bind(fsImpl, fsImpl.statFile),
		readonlyFile: bind(fsImpl, fsImpl.readonlyFile),
		readonlySubRoot: bind(fsImpl, fsImpl.readonlySubRoot),
		close: bind(fsImpl, fsImpl.close),
		getByteSink: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.getByteSink!) : throwFSReadonlyExc),
		writeBytes: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.writeBytes!) : throwFSReadonlyExc),
		writeTxtFile: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.writeTxtFile!) : throwFSReadonlyExc),
		writeJSONFile: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.writeJSONFile!) : throwFSReadonlyExc),
		makeFolder: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.makeFolder!) : throwFSReadonlyExc),
		deleteFile: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.deleteFile!) : throwFSReadonlyExc),
		deleteFolder: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.deleteFolder!) : throwFSReadonlyExc),
		move: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.move!) : throwFSReadonlyExc),
		copyFile: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.copyFile!) : throwFSReadonlyExc),
		copyFolder: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.copyFolder!) : throwFSReadonlyExc),
		writableFile: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.writableFile!) : throwFSReadonlyExc),
		writableSubRoot: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.writableSubRoot!) : throwFSReadonlyExc),
		saveFile: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.saveFile!) : throwFSReadonlyExc),
		saveFolder: ((fsImpl.writable) ?
			bind(fsImpl, fsImpl.saveFolder!) : throwFSReadonlyExc)
	};
	if ((<Linkable> <any> fsImpl).getLinkParams) {
		(<Linkable> <any> w).getLinkParams =
			bind(fsImpl, (<Linkable> <any> fsImpl).getLinkParams);
	}
	return w;
}
	
Object.freeze(exports);