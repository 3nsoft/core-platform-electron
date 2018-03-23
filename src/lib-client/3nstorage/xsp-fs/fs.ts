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

/**
 * Everything in this module is assumed to be inside of a file system
 * reliance set, exposing to outside only file system's wrap.
 */

import { makeFileException, Code as excCode, FileException }
	from '../../../lib-common/exceptions/file';
import { NodeInFS, NodeCrypto } from './node-in-fs';
import { FolderNode, FolderLinkParams, FolderInfo } from './folder-node';
import { FileNode, FileLinkParams } from './file-node';
import { FileObject, readBytesFrom } from './file';
import { Storage } from './common';
import { arrays, secret_box as sbox } from 'ecma-nacl';
import { Linkable, LinkParameters, wrapWritableFS, wrapReadonlyFile,
	wrapReadonlyFS, wrapWritableFile, wrapIntoVersionlessReadonlyFS }
	from '../../files';
import { selectInFS } from '../../files-select';
import { posix } from 'path';
import { pipe } from '../../../lib-common/byte-streaming/pipe';
import { utf8 } from '../../../lib-common/buffer-utils';
import { bind } from '../../../lib-common/binding';
import { Observable } from 'rxjs';

function splitPathIntoParts(path: string): string[] {
	return posix.resolve('/', path).split('/').filter(part => !!part);
}

function setExcPath(path: string): (exc: FileException) => never {
	return (exc: FileException): never => {
		if (exc.notFound || exc.notDirectory || exc.alreadyExists || exc.notFile) {
			exc.path = path;
		}
		throw exc;
	}
}

function split(path: string): { folderPath: string[]; fileName: string; } {
	const folderPath = splitPathIntoParts(path);
	const fileName = folderPath[folderPath.length-1];
	folderPath.splice(folderPath.length-1, 1);
	return { folderPath, fileName };
}

type ByteSource = web3n.ByteSource;
type ByteSink = web3n.ByteSink;
type FileStats = web3n.files.FileStats;
type FS = web3n.files.FS;
type WritableFS = web3n.files.WritableFS;
type ReadonlyFS = web3n.files.ReadonlyFS;
type File = web3n.files.File;
type WritableFile = web3n.files.WritableFile;
type ReadonlyFile = web3n.files.ReadonlyFile;
type FSType = web3n.files.FSType;
type ListingEntry = web3n.files.ListingEntry;
type SymLink = web3n.files.SymLink;
type FolderEvent = web3n.files.FolderEvent;
type Observer<T> = web3n.Observer<T>;
type SelectCriteria = web3n.files.SelectCriteria;
type FSCollection = web3n.files.FSCollection;

export class XspFS implements WritableFS {
	
	type: FSType;
	v = new V();
	private isSubRoot = false;
	
	private constructor(
			public storage: Storage,
			public writable: boolean,
			public name = '') {
		this.type = this.storage.type;
		Object.seal(this);
	}
	
	async readonlySubRoot(path: string): Promise<ReadonlyFS> {
		const pathParts = splitPathIntoParts(path);
		const folder = await this.v.root.getFolderInThisSubTree(pathParts, false)
		.catch(setExcPath(path));
		const folderName = ((pathParts.length === 0) ?
			this.name : pathParts[pathParts.length-1]);
		const fs = new XspFS(this.storage, false, folderName);
		fs.isSubRoot = true;
		fs.v.root = folder;
		return wrapReadonlyFS(fs);
	}

	async writableSubRoot(path: string, create = true, exclusive = false):
			Promise<WritableFS> {
		const pathParts = splitPathIntoParts(path);
		const folder = await this.v.root.getFolderInThisSubTree(
			pathParts, create, exclusive)
		.catch(setExcPath(path));
		const folderName = ((pathParts.length === 0) ?
			this.name : pathParts[pathParts.length-1]);
		const fs = new XspFS(this.storage, true, folderName);
		fs.isSubRoot = true;
		fs.v.root = folder;
		return wrapWritableFS(fs);
	}
	
	static async makeNewRoot(storage: Storage, key: Uint8Array):
			Promise<WritableFS> {
		const fs = new XspFS(storage, true);
		fs.v.root = await FolderNode.newRoot(fs.storage, key);
		return wrapWritableFS(fs);
	}
	
	static async makeExisting(storage: Storage, key: Uint8Array):
			Promise<WritableFS> {
		const fs = new XspFS(storage, true);
		const objSrc = await storage.getObj(null!);
		fs.v.root = await FolderNode.rootFromObjBytes(
			fs.storage, undefined, null, objSrc, key);
		return wrapWritableFS(fs);
	}

	static makeASMailMsgRootFromJSON(storage: Storage, folderJson: FolderInfo,
			rootName?: string): ReadonlyFS {
		const fs = new XspFS(storage, false, rootName);
		fs.v.root = FolderNode.rootFromJSON(storage, rootName, folderJson);
		return wrapIntoVersionlessReadonlyFS(fs);
	}
	
	/**
	 * Note that this method doesn't close storage.
	 */
	async close(): Promise<void> {
		this.v.root = (undefined as any);
		this.storage = (undefined as any);
	}
	
	async makeFolder(path: string, exclusive = false): Promise<void> {
		const folderPath = splitPathIntoParts(path);
		await this.v.root.getFolderInThisSubTree(folderPath, true, exclusive)
		.catch(setExcPath(path));
	}

	select(path: string, criteria: SelectCriteria):
			Promise<{ items: FSCollection; completion: Promise<void>; }> {
		return selectInFS(this, path, criteria);
	}
	
	async deleteFolder(path: string, removeContent = false): Promise<void> {
		const { fileName: folderName, folderPath: parentPath } = split(path);
		const parentFolder = await this.v.root.getFolderInThisSubTree(parentPath)
		.catch(setExcPath(parentPath.join('/')));
		if (typeof folderName !== 'string') { throw new Error(
			'Cannot remove root folder'); }
		const folder = (await parentFolder.getFolder(folderName)
		.catch(setExcPath(path)))!;
		if (!removeContent && !folder.isEmpty()) {
			throw makeFileException(excCode.notEmpty, path);
		}
		await parentFolder.removeChild(folder);
	}
	
	async deleteFile(path: string): Promise<void> {
		const { fileName, folderPath } = split(path);
		const parentFolder = await this.v.root.getFolderInThisSubTree(folderPath)
		.catch(setExcPath(path));
		const file = await parentFolder.getFile(fileName)
		.catch(setExcPath(path));
		await parentFolder.removeChild(file!);
	}
	
	async deleteLink(path: string): Promise<void> {
		const { fileName, folderPath } = split(path);
		const parentFolder = await this.v.root.getFolderInThisSubTree(folderPath)
		.catch(setExcPath(path));
		const link = await parentFolder.getLink(fileName)
		.catch(setExcPath(path));
		await parentFolder.removeChild(link!);
	}
	
	async move(initPath: string, newPath: string): Promise<void> {
		const srcFolderPath = splitPathIntoParts(initPath);
		if (srcFolderPath.length === 0) { throw new Error(
			'Bad initial path: it points to filesystem root'); }
		const initFName = srcFolderPath[srcFolderPath.length-1];
		srcFolderPath.splice(srcFolderPath.length-1, 1);
		const dstFolderPath = splitPathIntoParts(newPath);
		if (dstFolderPath.length === 0) { throw new Error(
			'Bad new path: it points to filesystem root'); }
		const dstFName = dstFolderPath[dstFolderPath.length-1];
		dstFolderPath.splice(dstFolderPath.length-1, 1);
		try {
			const srcFolder = await this.v.root.getFolderInThisSubTree(
				srcFolderPath);
			srcFolder.hasChild(initFName, true);
			const dstFolder = await this.v.root.getFolderInThisSubTree(
				dstFolderPath, true);
			await srcFolder.moveChildTo(initFName, dstFolder, dstFName);
		} catch (exc) {
			if ((<FileException> exc).notFound) {
				(<FileException> exc).path = initPath;
			} else if ((<FileException> exc).alreadyExists) {
				(<FileException> exc).path = newPath;
			} else if ((<FileException> exc).notDirectory) {
				(<FileException> exc).path = newPath;
			}
			throw exc;
		}
	}

	async statFile(path: string): Promise<FileStats> {
		const f = await this.v.getOrCreateFile(path, false, false);
		const { src, version } = await f.readSrc();
		const stat: FileStats = {
			size: await src.getSize(),
			version
		};
		return stat;
	}

	async checkFolderPresence(path: string, throwIfMissing = false):
			Promise<boolean> {
		const folderPath = splitPathIntoParts(path);
		const f = await this.v.root.getFolderInThisSubTree(folderPath, false)
		.catch(setExcPath(path))
		.catch((exc: FileException) => {
			if ((exc.notFound || exc.notDirectory) && !throwIfMissing) { return; }
			throw exc;
		});
		return !!f;
	}
	
	async checkFilePresence(path: string, throwIfMissing?: boolean):
			Promise<boolean> {
		const f = await this.v.getOrCreateFile(path, false, false)
		.catch(setExcPath(path))
		.catch((exc: FileException) => {
			if ((exc.notFound || exc.notFile) && !throwIfMissing) { return; }
			throw exc;
		});
		return !!f;
	}
	
	async checkLinkPresence(path: string, throwIfMissing?: boolean):
			Promise<boolean> {
		const { fileName, folderPath } = split(path);
		const folder = await this.v.root.getFolderInThisSubTree(folderPath)
		.catch(setExcPath(path));
		const link = await folder.getLink(fileName)
		.catch(setExcPath(path))
		.catch((exc: FileException) => {
			if ((exc.notFound || exc.notLink) && !throwIfMissing) { return; }
			throw exc;
		});
		return !!link;
	}

	async copyFolder(src: string, dst: string, mergeAndOverwrite = false):
			Promise<void> {
		const lst = await this.listFolder(src);
		await this.makeFolder(dst, !mergeAndOverwrite);
		for (const f of lst) {
			if (f.isFile) {
				await this.copyFile(`${src}/${f.name}`, `${dst}/${f.name}`,
					mergeAndOverwrite);
			} else if (f.isFolder) {
				await this.copyFolder(`${src}/${f.name}`, `${dst}/${f.name}`,
					mergeAndOverwrite);
			} else if (f.isLink) {
				const link = await this.readLink(f.name);
				const t = await link.target();
				await this.link(`${dst}/${f.name}`, t);
			}
		}
	}

	async saveFolder(folder: FS, dst: string, mergeAndOverwrite = false):
			Promise<void> {
		const lst = (folder.v ?
			(await folder.v.listFolder('/')).lst :
			await folder.listFolder('/'));
		await this.makeFolder(dst, !mergeAndOverwrite);
		for (const f of lst) {
			if (f.isFile) {
				const src = (folder.v ?
					(await folder.v.getByteSource(f.name)).src :
					await folder.getByteSource(f.name));
				const sink = await this.getByteSink(dst, true, !mergeAndOverwrite);
				await pipe(src, sink);
			} else if (f.isFolder) {
				const subFolder = await folder.readonlySubRoot(f.name);
				await this.saveFolder(subFolder, `${dst}/${f.name}`,
					mergeAndOverwrite);
			} else if (f.isLink) {
				const link = await this.readLink(f.name);
				const t = await link.target();
				await this.link(`${dst}/${f.name}`, t);
			}
		}
	}

	private ensureLinkingAllowedTo(params: LinkParameters<any>): void {
		if (this.storage.type === 'local') {
			return;
		} else if (this.storage.type === 'synced') {
			if ((params.storageType === 'share') ||
				(params.storageType === 'synced')) { return; }
		} else if (this.storage.type === 'share') {
			if (params.storageType === 'share') { return; }
		}
		throw new Error(`Cannot create link to ${params.storageType} from ${this.storage.type} storage.`);
	}

	async link(path: string, target: File | FS):
			Promise<void> {
		if (!target ||
				(typeof (<Linkable> <any> target).getLinkParams !== 'function')) {
			throw new Error('Given target is not-linkable');
		}
		const params = await (<Linkable> <any> target).getLinkParams();
		this.ensureLinkingAllowedTo(params);
		const { fileName, folderPath } = split(path);
		const folder = await this.v.root.getFolderInThisSubTree(folderPath, true)
		.catch(setExcPath(path));
		await folder.createLink(fileName, params);
	}

	async readLink(path: string): Promise<SymLink> {
		const { fileName, folderPath } = split(path);
		const folder = await this.v.root.getFolderInThisSubTree(folderPath)
		.catch(setExcPath(path));
		const link = await folder.getLink(fileName)
		.catch(setExcPath(path));
		return await link!.read();
	}

	async getLinkParams(): Promise<LinkParameters<any>> {
		const linkParams = this.v.root.getParamsForLink();
		linkParams.params.folderName = this.name;
		linkParams.readonly = !this.writable;
		return linkParams;
	}

	static async makeFolderFromLinkParams(storage: Storage,
			params: LinkParameters<FolderLinkParams>):
			Promise<ReadonlyFS|WritableFS> {
		const name = params.params.folderName;
		const writable = !params.readonly;
		const fs = new XspFS(storage, writable, name);
		fs.v.root = await FolderNode.rootFromLinkParams(storage, params.params);
		return (fs.writable ?
			wrapWritableFS(fs) : wrapReadonlyFS(fs));
	}

	watchFolder(path: string, observer: Observer<FolderEvent>): () => void {
		const watchSub = Observable.fromPromise(
			this.v.root.getFolderInThisSubTree(splitPathIntoParts(path), false))
		.flatMap(f => f.event$)
		.subscribe(observer.next, observer.error, observer.complete);
		return () => watchSub.unsubscribe();
	}

	watchFile(): never {
		throw new Error('Not implemented, yet');
	}

	watchTree(): never {
		throw new Error('Not implemented, yet');
	}
	
	async readonlyFile(path: string): Promise<ReadonlyFile> {
		const fNode = await this.v.getOrCreateFile(path, false, false);
		return wrapReadonlyFile(FileObject.makeExisting(fNode, false));
	}

	async writableFile(path: string, create = true, exclusive = false):
			Promise<WritableFile> {
		const exists = await this.checkFilePresence(path);
		if (exists) {
			if (create && exclusive) { throw makeFileException(
				excCode.alreadyExists, path); }
			const fNode = await this.v.getOrCreateFile(path, false, false);
			return wrapWritableFile(
				FileObject.makeExisting(fNode, true) as WritableFile);
		} else {
			if (!create) { throw makeFileException(excCode.notFound, path); }
			return wrapWritableFile(FileObject.makeForNotExisiting(
				posix.basename(path),
				() => this.v.getOrCreateFile(path, create, exclusive)));
		}
	}

	async copyFile(src: string, dst: string, overwrite = false): Promise<void> {
		const srcBytes = await this.getByteSource(src);
		const sink = await this.getByteSink(dst, true, !overwrite);
		await pipe(srcBytes, sink);
	}

	async saveFile(file: File, dst: string, overwrite = false): Promise<void> {
		const src = (file.v ?
				(await file.v.getByteSource()).src :
				await file.getByteSource());
		const sink = await this.getByteSink(dst, true, !overwrite);
		await pipe(src, sink);
	}

	async listFolder(folder: string): Promise<ListingEntry[]> {
		const { lst } = await this.v.listFolder(folder);
		return lst;
	}

	async readJSONFile<T>(path: string): Promise<T> {
		const { json } = await this.v.readJSONFile<T>(path);
		return json;
	}

	async readTxtFile(path: string): Promise<string> {
		const { txt } = await this.v.readTxtFile(path);
		return txt;
	}

	async readBytes(path: string, start?: number, end?: number):
			Promise<Uint8Array|undefined> {
		const { bytes } = await this.v.readBytes(path, start, end);
		return bytes;
	}

	async getByteSource(path: string): Promise<web3n.ByteSource> {
		const { src } = await this.v.getByteSource(path);
		return src;
	}

	async writeJSONFile(path: string, json: any, create?: boolean,
			exclusive?: boolean): Promise<void> {
		await this.v.writeJSONFile(path, json, create, exclusive);
	}

	async writeTxtFile(path: string, txt: string, create?: boolean,
			exclusive?: boolean): Promise<void> {
		await this.v.writeTxtFile(path, txt, create, exclusive);
	}

	async writeBytes(path: string, bytes: Uint8Array, create?: boolean,
			exclusive?: boolean): Promise<void> {
		await this.v.writeBytes(path, bytes,create, exclusive);
	}

	async getByteSink(path: string, create?: boolean, exclusive?: boolean):
			Promise<web3n.ByteSink> {
		const { sink } = await this.v.getByteSink(path, create, exclusive);
		return sink;
	}

}
Object.freeze(XspFS.prototype);
Object.freeze(XspFS);

type WritableFSVersionedAPI = web3n.files.WritableFSVersionedAPI;

class V implements WritableFSVersionedAPI {

	root: FolderNode = (undefined as any);

	constructor() {
		Object.seal(this);
	}
	
	async getOrCreateFile(path: string, create: boolean,
			exclusive: boolean): Promise<FileNode> {
		const { fileName, folderPath } = split(path);
		const folder = await this.root.getFolderInThisSubTree(folderPath, create)
		.catch(setExcPath(path));
		const nullOnMissing = create;
		let file = await folder.getFile(fileName, nullOnMissing)
		.catch(setExcPath(path));
		if (file) {
			if (exclusive) {
				throw makeFileException(excCode.alreadyExists, path);
			}
		} else {
			file = await folder.createFile(fileName, exclusive);
		}
		return file;
	}
	
	async listFolder(path: string):
			Promise<{ lst: ListingEntry[]; version: number; }> {
		const folder = await this.root.getFolderInThisSubTree(
			splitPathIntoParts(path), false).catch(setExcPath(path));
		return folder.list();
	}

	async writeBytes(path: string, bytes: Uint8Array,
			create = true, exclusive = false): Promise<number> {
		const f = await this.getOrCreateFile(path, create, exclusive);
		return f.save(bytes);
	}

	async readBytes(path: string, start?: number, end?: number):
			Promise<{ bytes: Uint8Array|undefined; version: number; }> {
		const file = await this.getOrCreateFile(path, false, false);
		const { src, version } = await file.readSrc();
		const bytes = await readBytesFrom(src, start, end);
		return { bytes, version };
	}
	
	writeTxtFile(path: string, txt: string, create?: boolean,
			exclusive?: boolean): Promise<number> {
		const bytes = utf8.pack(txt);
		return this.writeBytes(path, bytes, create, exclusive);
	}
		
	async readTxtFile(path: string):
			Promise<{ txt: string; version: number; }> {
		const { bytes, version } = await this.readBytes(path);
		try {
			const txt = (bytes ? utf8.open(bytes) : '');
			return { txt, version };
		} catch (err) {
			throw makeFileException(excCode.parsingError, path, err);
		}
	}

	writeJSONFile(path: string, json: any, create?: boolean,
			exclusive?: boolean): Promise<number> {
		const txt = JSON.stringify(json);
		return this.writeTxtFile(path, txt, create, exclusive);
	}
		
	async readJSONFile<T>(path: string):
			Promise<{ json: T; version: number; }> {
		const { txt, version } = await this.readTxtFile(path);
		try {
			const json = JSON.parse(txt);
			return { json, version };
		} catch (err) {
			throw makeFileException(excCode.parsingError, path, err);
		}
	}

	async getByteSink(path: string, create = true,
			exclusive = false): Promise<{ sink: ByteSink; version: number; }> {
		const f = await this.getOrCreateFile(path, create, exclusive);
		return f.writeSink();
	}

	async getByteSource(path: string):
			Promise<{ src: ByteSource; version: number; }> {
		const f = await this.getOrCreateFile(path, false, false);
		return f.readSrc();
	}

}
Object.freeze(V.prototype);
Object.freeze(V);

Object.freeze(exports);