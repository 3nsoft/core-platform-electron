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

/**
 * Everything in this module is assumed to be inside of a file system
 * reliance set, exposing to outside only file system's wrap.
 */

import { makeFileException, Code as excCode, FileException }
	from '../../../lib-common/exceptions/file';
import { Folder, File } from './fs-entities';
import { ListingEntry, FS as FileSystem, wrapFSImplementation,
	sysFolders, Storage } from './common';
import * as random from '../../random-node';
import { arrays, secret_box as sbox } from 'ecma-nacl';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { AbstractFS } from '../../files';

let OBJID_LEN = 40;
let EMPTY_BYTE_ARRAY = new Uint8Array(0);

function splitPathIntoParts(path: string): string[] {
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
				pathParts.splice(i, 2);
				i -= 2;
			}
		}
	}
	return pathParts;
}

function setFileExcMessage(path: string): (exc: FileException) => any {
	return (exc: FileException) => {
		if (exc.notFound) {
			exc.message = `File '${path}' does not exist`;
		} else if (exc.notFile) {
			exc.message = `Entity '${path}' is not a file`;
		}
		throw exc;
	}
}

function setFolderExcMessage(path: string): (exc: FileException) => any {
	return (exc: FileException) => {
		if (exc.notFound) {
			exc.message = `Folder '${path}' does not exist`;
		} else if (exc.notDirectory) {
			exc.message = `Entity '${path}' is not a folder`;
		} else if (exc.alreadyExists) {
			exc.message = `Folder ${path} already exist`;
		}
		throw exc;
	}
}

export class FS extends AbstractFS implements FileSystem {
	
	arrFactory = arrays.makeFactory();
	objs = new Map<string, File|Folder>();
	private root: Folder = null;
	private isSubRoot = true;
	
	constructor(
			public storage: Storage) {
		super();
		Object.seal(this);
	}
	
	/**
	 * @return new objId, with null placed under this id, reserving it in
	 * objs map.
	 */
	generateNewObjId(): string {
		let id = random.stringOfB64UrlSafeChars(OBJID_LEN);
		if (!this.objs.has(id)) {
			this.objs.set(id, null);
			return id;
		} else {
			return this.generateNewObjId();
		}
	}
	
	private setRoot(root: Folder): void {
		if (this.root) { throw new Error("Root is already set."); }
		this.root = root;
		if ('string' === typeof root.objId) {
			this.objs.set(root.objId, root);
		}
	}
	
	async makeSubRoot(path:string): Promise<FileSystem> {
		let folder = await this.root.getFolderInThisSubTree(
			splitPathIntoParts(path), true)
		.catch(setFolderExcMessage(path));
		let fs = new FS(this.storage);
		fs.setRoot(Folder.rootFromFolder(fs,
			<Folder> this.objs.get(folder.objId)));
		fs.isSubRoot = true;
		return Object.freeze(wrapFSImplementation(fs));
	}
	
	static makeNewRoot(storage: Storage,
			masterEnc: sbox.Encryptor): FileSystem {
		let fs = new FS(storage);
		fs.setRoot(Folder.newRoot(fs, masterEnc));
		fs.root.createFolder(sysFolders.appData);
		fs.root.createFolder(sysFolders.userFiles);
		return Object.freeze(wrapFSImplementation(fs));
	}
	
	static async makeExisting(storage: Storage, rootObjId: string,
			masterDecr: sbox.Decryptor, rootName: string = null):
			Promise<FileSystem> {
		let fs = new FS(storage);
		let objSrc = await storage.getObj(rootObjId)
		let root = await Folder.rootFromObjBytes(
			fs, rootName, rootObjId, objSrc, masterDecr);
		fs.setRoot(root);
		return Object.freeze(wrapFSImplementation(fs));
	}
	
	async close(): Promise<void> {
		// TODO add destroing of obj's (en)decryptors
		
		this.root = null;
		this.storage = null;
		this.objs.clear();
		// this.objTasks = null;
	}
	
	private changeObjId(obj: Folder|File, newId: string): void {
// TODO implementation (if folder, change children's parentId as well)
		throw new Error("Not implemented, yet");
	}
	
	async listFolder(path: string): Promise<ListingEntry[]> {
		let folder = await this.root.getFolderInThisSubTree(
			splitPathIntoParts(path), false)
		.catch(setFolderExcMessage(path));
		return folder.list();
	}
	
	async makeFolder(path: string, exclusive = false): Promise<void> {
		let folderPath = splitPathIntoParts(path);
		await this.root.getFolderInThisSubTree(folderPath, true, exclusive)
		.catch(setFolderExcMessage(path));
	}
	
	async deleteFolder(path: string, removeContent = false): Promise<void> {
		let folderPath = splitPathIntoParts(path);
		let folder = await this.root.getFolderInThisSubTree(folderPath)
		.catch(setFolderExcMessage(path));
		if (removeContent) {
			let content = folder.list();
			for (let entry of content) {
				if (entry.isFile) {
					let file = await folder.getFile(entry.name);
					folder.removeChild(file);
				} else if (entry.isFolder) {
					await this.deleteFolder(`${path}/${entry.name}`, true);
				}
			}
		}
		await folder.remove();
	}
	
	async deleteFile(path: string): Promise<void> {
		let folderPath = splitPathIntoParts(path);
		let fileName = folderPath[folderPath.length-1];
		folderPath.splice(folderPath.length-1, 1);
		let folder = await this.root.getFolderInThisSubTree(folderPath)
		.catch(setFileExcMessage(path));
		let file = await folder.getFile(fileName)
		.catch(setFileExcMessage(path));
		file.remove();
	}
	
	private async getOrCreateFile(path: string, create: boolean,
			exclusive: boolean): Promise<File> {
		let folderPath = splitPathIntoParts(path);
		let fileName = folderPath[folderPath.length-1];
		folderPath.splice(folderPath.length-1, 1);
		let folder = await this.root.getFolderInThisSubTree(folderPath, create)
		.catch(setFileExcMessage(path));
		let nullOnMissing = create;
		let file = await folder.getFile(fileName, nullOnMissing)
		.catch(setFileExcMessage(path));
		if (file) {
			if (exclusive) {
				throw makeFileException(excCode.alreadyExists,
					`File ${path} already exists.`);
			}
		} else {
			file = folder.createFile(fileName);
		}
		return file;
	}

	async writeBytes(path: string, bytes: Uint8Array, create = true,
			exclusive = false): Promise<void> {
		let f = await this.getOrCreateFile(path, create, exclusive);
		await f.save(bytes);
	}

	async readBytes(path: string, start?: number, end?: number):
			Promise<Uint8Array> {
		if ((typeof start === 'number') && (start < 0)) { throw new Error(
			`Parameter start has bad value: ${start}`); }
		if ((typeof end === 'number') && (end < 0)) { throw new Error(
			`Parameter end has bad value: ${end}`); }
		let file = await this.getOrCreateFile(path, false, false);
		let src = await file.readSrc();
		let size = await src.getSize();
		if (typeof size !== 'number') { throw new Error(
			'File size is not known.'); }
		if (typeof start === 'number') {
			if (start >= size) { return EMPTY_BYTE_ARRAY; }
			if (typeof end === 'number') {
				end = Math.min(size, end);
				if (end <= start) { return EMPTY_BYTE_ARRAY; }
			} else {
				end = size;
			}
			await src.seek(start);
			let bytes = await src.read(end - start);
			return bytes;
		} else {
			let bytes = await src.read(null);
			return (bytes ? bytes : EMPTY_BYTE_ARRAY);
		}
	}
	
	async move(initPath: string, newPath: string): Promise<void> {
		let srcFolderPath = splitPathIntoParts(initPath);
		if (srcFolderPath.length === 0) { throw new Error(
			'Bad initial path: it points to filesystem root'); }
		let initFName = srcFolderPath[srcFolderPath.length-1];
		srcFolderPath.splice(srcFolderPath.length-1, 1);
		let dstFolderPath = splitPathIntoParts(newPath);
		if (dstFolderPath.length === 0) { throw new Error(
			'Bad new path: it points to filesystem root'); }
		let dstFName = dstFolderPath[dstFolderPath.length-1];
		dstFolderPath.splice(dstFolderPath.length-1, 1);
		try {
			let srcFolder = await this.root.getFolderInThisSubTree(srcFolderPath);
			srcFolder.hasChild(initFName, true);
			let dstFolder = await this.root.getFolderInThisSubTree(
				dstFolderPath, true);
			await srcFolder.moveChildTo(initFName, dstFolder, dstFName);
		} catch (exc) {
			if ((<FileException> exc).notFound) {
				(<FileException> exc).message = `Path ${initPath} does not exist.`;
			} else if ((<FileException> exc).alreadyExists) {
				(<FileException> exc).message = `Path ${newPath} already exist.`;
			} else if ((<FileException> exc).notDirectory) {
				(<FileException> exc).message = `Cannot make new path ${newPath} cause some intermediate part is not a folder.`;
			}
			throw exc;
		}
	}

	async getByteSink(path: string, create = true, exclusive = false):
			Promise<Web3N.ByteSink> {
		let f = await this.getOrCreateFile(path, create, exclusive);
		return f.writeSink().sink;
	}

	async getByteSource(path: string): Promise<Web3N.ByteSource> {
		let f = await this.getOrCreateFile(path, false, false);
		return f.readSrc();
	}

	async statFile(path: string): Promise<Web3N.Files.FileStats> {
		// XXX add implementation
		throw new Error('fs method statFile is not implemented, yet.');
	}

	async checkFolderPresence(path: string, throwIfMissing = false):
			Promise<boolean> {
		let folderPath = splitPathIntoParts(path);
		let f = await this.root.getFolderInThisSubTree(folderPath, false)
		.catch(setFolderExcMessage(path))
		.catch((exc: FileException) => {
			if (exc.notFound && !throwIfMissing) { return; }
			throw exc;
		});
		return !!f;
	}
	
	async checkFilePresence(path: string, throwIfMissing?: boolean):
			Promise<boolean> {
		let f = await this.getOrCreateFile(path, false, false)
		.catch(setFileExcMessage(path))
		.catch((exc: FileException) => {
			if (exc.notFound && !throwIfMissing) { return; }
			throw exc;
		});
		return !!f;
	}

}
Object.freeze(FS.prototype);
Object.freeze(FS);

Object.freeze(exports);