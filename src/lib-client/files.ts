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
import { makeFileException, Code as excCode, maskPathInExc }
	from '../lib-common/exceptions/file';
import { toBuffer, utf8 } from '../lib-common/buffer-utils';

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

export type FileStats = Web3N.Files.FileStats;
export type FS = Web3N.Files.FS;
export type ListingEntry = Web3N.Files.ListingEntry;
export type ByteSink = Web3N.ByteSink;
export type ByteSource = Web3N.ByteSource;

export abstract class AbstractFS implements FS {
	
	abstract makeSubRoot(folder: string): Promise<FS>;
	
	abstract statFile(path: string): Promise<FileStats>;
	
	abstract readBytes(path: string, start?: number, end?: number):
		Promise<Uint8Array>;
	
	abstract getByteSink(path: string, create?: boolean, exclusive?: boolean):
		Promise<ByteSink>;
	
	abstract getByteSource(path: string): Promise<ByteSource>;
	
	abstract writeBytes(path: string, bytes: Uint8Array, create?: boolean,
			exclusive?: boolean): Promise<void>;
	
	writeTxtFile(path: string, txt: string, create = true, exclusive = false):
			Promise<void> {
		let bytes = utf8.pack(txt);
		return this.writeBytes(path, bytes, create, exclusive);
	}
	
	async readTxtFile(path: string): Promise<string> {
		let bytes = await this.readBytes(path);
		return utf8.open(bytes);
	}
	
	writeJSONFile(path: string, json: any, create = true, exclusive = false):
			Promise<void> {
		let bytes = Buffer.from(JSON.stringify(json), 'utf8');
		return this.writeBytes(path, bytes, create, exclusive);
	}

	async readJSONFile<T>(path: string): Promise<T> {
		let bytes = await this.readBytes(path);
		return JSON.parse(utf8.open(bytes));
	}
	
	abstract deleteFile(path: string): Promise<void>;
	
	abstract makeFolder(path: string, exclusive?: boolean): Promise<void>;
	
	abstract checkFolderPresence(path: string, throwIfMissing?: boolean):
			Promise<boolean>;
	
	abstract checkFilePresence(path: string, throwIfMissing?: boolean):
			Promise<boolean>;
	
	abstract deleteFolder(path: string, removeContent?: boolean): Promise<void>;
	
	abstract listFolder(folder: string): Promise<ListingEntry[]>;
	
	abstract move(initPath: string, newPath: string): Promise<void>;

	async readonlyFile(path: string): Promise<Web3N.Files.File> {
		let exists = await this.checkFilePresence(path);
		let f = new FileObject(this, path, exists);
		return f.wrap(false);
	}

	async writableFile(path: string, create?: boolean, exclusive?: boolean):
			Promise<Web3N.Files.File> {
		let exists = await this.checkFilePresence(path);
		if (exists && create && exclusive) { throw makeFileException(
			excCode.alreadyExists, `Path ${path} already exists.`); }
		let f = new FileObject(this, path, exists);
		return f.wrap(true);
	}

}

export class FileObject implements Web3N.Files.File {

	public name: string;

	public isNew: boolean;

	private pathPrefixMaskLen: number;

	constructor(private fs: FS,
			private path: string,
			private exists: boolean) {
		this.name = basename(this.path);
		this.isNew = !exists;
		this.pathPrefixMaskLen = this.path.length - this.name.length;
		Object.seal(this);
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

	async readTxt(): Promise<string> {
		try {
			return await this.fs.readTxtFile(this.path);
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}

	async readJSON(): Promise<any> {
		try {
			return await this.fs.readJSONFile(this.path);
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}

	async getByteSink(): Promise<ByteSink> {
		try {
			return await this.fs.getByteSink(
				this.path, !this.exists, !this.exists);
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}
	
	async getByteSource(): Promise<ByteSource> {
		try {
			return await this.fs.getByteSource(this.path);
		} catch (e) {
			throw maskPathInExc(this.pathPrefixMaskLen, e);
		}
	}

	wrap(writable: boolean): Web3N.Files.File {
		let w: Web3N.Files.File = {
			isNew: this.isNew,
			name: this.name,
			getByteSource: bind(this, this.getByteSource),
			readJSON: bind(this, this.readJSON),
			readTxt: bind(this, this.readTxt)
		};
		if (writable) {
			w.getByteSink = bind(this, this.getByteSink);
			w.writeJSON = bind(this, this.writeJSON);
			w.writeTxt = bind(this, this.writeTxt);
		}
		return Object.freeze(w);
	}

}
Object.freeze(FileObject.prototype);
Object.freeze(FileObject);

export function wrapFSImplementation(fsImpl: FS): FS {
	let wrap: FS = {
		getByteSink: bind(fsImpl, fsImpl.getByteSink),
		getByteSource: bind(fsImpl, fsImpl.getByteSource),
		writeBytes: bind(fsImpl, fsImpl.writeBytes),
		readBytes: bind(fsImpl, fsImpl.readBytes),
		writeTxtFile: bind(fsImpl, fsImpl.writeTxtFile),
		readTxtFile: bind(fsImpl, fsImpl.readTxtFile),
		writeJSONFile: bind(fsImpl, fsImpl.writeJSONFile),
		readJSONFile: bind(fsImpl, fsImpl.readJSONFile),
		listFolder: bind(fsImpl, fsImpl.listFolder),
		makeSubRoot: bind(fsImpl, fsImpl.makeSubRoot),
		makeFolder: bind(fsImpl, fsImpl.makeFolder),
		deleteFile: bind(fsImpl, fsImpl.deleteFile),
		deleteFolder: bind(fsImpl, fsImpl.deleteFolder),
		checkFolderPresence: bind(fsImpl, fsImpl.checkFolderPresence),
		checkFilePresence: bind(fsImpl, fsImpl.checkFilePresence),
		move: bind(fsImpl, fsImpl.move),
		statFile: bind(fsImpl, fsImpl.statFile),
		readonlyFile: bind(fsImpl, fsImpl.readonlyFile),
		writableFile: bind(fsImpl, fsImpl.writableFile)
	};
	return wrap;
}
	
Object.freeze(exports);