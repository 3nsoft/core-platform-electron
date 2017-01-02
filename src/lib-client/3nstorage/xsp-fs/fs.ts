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
import { NodeInFS, NodeCrypto, SymLink } from './node-in-fs';
import { FolderNode, FolderLinkParams, FolderJson } from './folder-node';
import { FileNode, FileLinkParams } from './file-node';
import { FileObject, readBytesFrom } from './file';
import { ListingEntry, FS as StorageFS, wrapFSImplementation,
	sysFolders, Storage, NodesContainer } from './common';
import { arrays, secret_box as sbox } from 'ecma-nacl';
import { AbstractFS, File, Linkable, LinkParameters } from '../../files';
import { basename } from 'path';
import { pipe } from '../../../lib-common/byte-streaming/pipe';
import { utf8 } from '../../../lib-common/buffer-utils';

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

function setExcPath(path: string): (exc: FileException) => never {
	return (exc: FileException): never => {
		if (exc.notFound || exc.notDirectory || exc.alreadyExists || exc.notFile) {
			exc.path = path;
		}
		throw exc;
	}
}

function split (path: string): { folderPath: string[]; fileName: string; } {
	let folderPath = splitPathIntoParts(path);
	let fileName = folderPath[folderPath.length-1];
	folderPath.splice(folderPath.length-1, 1);
	return { folderPath, fileName };
}

type ByteSource = web3n.ByteSource;
type ByteSink = web3n.ByteSink;
type FileStats = web3n.storage.FileStats;

export class FS extends AbstractFS implements StorageFS {
	
	arrFactory = arrays.makeFactory();
	private root: FolderNode = (undefined as any);
	private isSubRoot = false;
	
	private constructor(
			public storage: Storage,
			writable: boolean,
			folderName?: string,
			versioned = true) {
		super(folderName!, writable, versioned);
		Object.seal(this);
	}
	
	private async makeSubRoot(writable: boolean, path: string,
			folderName: string): Promise<StorageFS> {
		let pathParts = splitPathIntoParts(path);
		let folder = await this.root.getFolderInThisSubTree(pathParts, writable)
		.catch(setExcPath(path));
		if (folderName === undefined) {
			folderName = ((pathParts.length === 0) ?
				this.name : pathParts[pathParts.length-1]);
		}
		let fs = new FS(this.storage, writable, folderName, this.versioned);
		fs.isSubRoot = true;
		fs.root = folder;
		return Object.freeze(wrapFSImplementation(fs));
	}
	
	readonlySubRoot(folder: string, folderName?: string):
			Promise<StorageFS> {
		return this.makeSubRoot(false, folder, folderName!);
	}

	writableSubRoot(folder: string, folderName?: string):
			Promise<StorageFS> {
		return this.makeSubRoot(true, folder, folderName!);
	}
	
	static makeNewRoot(storage: Storage,
			masterEnc: sbox.Encryptor): StorageFS {
		let fs = new FS(storage, true);
		fs.root = FolderNode.newRoot(fs, masterEnc);
		fs.root.createFolder(sysFolders.appData);
		fs.root.createFolder(sysFolders.userFiles);
		return Object.freeze(wrapFSImplementation(fs));
	}
	
	static async makeExisting(storage: Storage, rootObjId: string,
			masterDecr: sbox.Decryptor, rootName?: string):
			Promise<StorageFS> {
		let fs = new FS(storage, true);
		let objSrc = await storage.getObj(rootObjId);
		fs.root = await FolderNode.rootFromObjBytes(
			fs, rootName, rootObjId, objSrc, masterDecr);
		return Object.freeze(wrapFSImplementation(fs));
	}

	static makeRootFromJSON(storage: Storage, folderJson: FolderJson,
			mkey: string, rootName?: string): StorageFS {
		let fs = new FS(storage, false, rootName, false);
		fs.root = FolderNode.rootFromJSON(storage, rootName, folderJson, mkey);
		return Object.freeze(wrapFSImplementation(fs));
	}
	
	/**
	 * Note that this method doesn't close storage.
	 */
	async close(): Promise<void> {
		this.root = (undefined as any);
		this.storage = (undefined as any);
	}
	
	private changeObjId(obj: NodeInFS<NodeCrypto>, newId: string): void {
// TODO implementation (if folder, change children's parentId as well)
		throw new Error("Not implemented, yet");
	}
	
	async versionedListFolder(path: string):
			Promise<{ lst: ListingEntry[]; version: number; }> {
		let folder = await this.root.getFolderInThisSubTree(
			splitPathIntoParts(path), false).catch(setExcPath(path));
		return folder.list();
	}
	
	async listFolder(path: string): Promise<ListingEntry[]> {
		let { lst } = await this.versionedListFolder(path);
		return lst;
	}
	
	async makeFolder(path: string, exclusive = false): Promise<void> {
		let folderPath = splitPathIntoParts(path);
		await this.root.getFolderInThisSubTree(folderPath, true, exclusive)
		.catch(setExcPath(path));
	}
	
	async deleteFolder(path: string, removeContent = false): Promise<void> {
		let folderPath = splitPathIntoParts(path);
		let folder = await this.root.getFolderInThisSubTree(folderPath)
		.catch(setExcPath(path));
		if (folder === this.root) {
			throw new Error('Cannot remove root folder'); }
		if (removeContent) {
			let { lst: content } = folder.list();
			for (let entry of content) {
				if (entry.isFile) {
					let file = await folder.getFile(entry.name);
					folder.removeChild(file!);
				} else if (entry.isFolder) {
					await this.deleteFolder(`${path}/${entry.name}`, true);
				}
			}
		}
		await folder.remove();
	}
	
	async deleteFile(path: string): Promise<void> {
		let { fileName, folderPath } = split(path);
		let folder = await this.root.getFolderInThisSubTree(folderPath)
		.catch(setExcPath(path));
		let file = await folder.getFile(fileName)
		.catch(setExcPath(path));
		file!.remove();
	}
	
	async deleteLink(path: string): Promise<void> {
		let { fileName, folderPath } = split(path);
		let folder = await this.root.getFolderInThisSubTree(folderPath)
		.catch(setExcPath(path));
		let link = await folder.getLink(fileName)
		.catch(setExcPath(path));
		link!.remove();
	}
	
	async getOrCreateFile(path: string, create: boolean,
			exclusive: boolean): Promise<FileNode> {
		let { fileName, folderPath } = split(path);
		let folder = await this.root.getFolderInThisSubTree(folderPath, create)
		.catch(setExcPath(path));
		let nullOnMissing = create;
		let file = await folder.getFile(fileName, nullOnMissing)
		.catch(setExcPath(path));
		if (file) {
			if (exclusive) {
				throw makeFileException(excCode.alreadyExists, path);
			}
		} else {
			file = folder.createFile(fileName);
		}
		return file;
	}

	async versionedWriteBytes(path: string, bytes: Uint8Array, create = true,
			exclusive = false): Promise<number> {
		let f = await this.getOrCreateFile(path, create, exclusive);
		return f.save(bytes);
	}

	async writeBytes(path: string, bytes: Uint8Array, create = true,
			exclusive = false): Promise<void> {
		await this.versionedWriteBytes(path, bytes, create, exclusive);
	}

	async versionedReadBytes(path: string, start?: number, end?: number):
			Promise<{ bytes: Uint8Array|undefined; version: number; }> {
		let file = await this.getOrCreateFile(path, false, false);
		let { src, version } = await file.readSrc();
		let bytes = await readBytesFrom(src, start, end);
		return { bytes, version };
	}

	async readBytes(path: string, start?: number, end?: number):
			Promise<Uint8Array|undefined> {
		let { bytes } = await this.versionedReadBytes(path, start, end);
		return bytes;
	}
	
	versionedWriteTxtFile(path: string, txt: string, create?: boolean,
			exclusive?: boolean): Promise<number> {
		let bytes = utf8.pack(txt);
		return this.versionedWriteBytes(path, bytes, create, exclusive);
	}
		
	async versionedReadTxtFile(path: string):
			Promise<{ txt: string; version: number; }> {
		let { bytes, version } = await this.versionedReadBytes(path);
		let txt = (bytes ? utf8.open(bytes) : '');
		return { txt, version };
	}

	versionedWriteJSONFile(path: string, json: any, create?: boolean,
			exclusive?: boolean): Promise<number> {
		let txt = JSON.stringify(json);
		return this.versionedWriteTxtFile(path, txt, create, exclusive);
	}
		
	async versionedReadJSONFile<T>(path: string):
			Promise<{ json: T; version: number; }> {
		let { txt, version } = await this.versionedReadTxtFile(path);
		let json = JSON.parse(txt);
		return { json, version };
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
				(<FileException> exc).path = initPath;
			} else if ((<FileException> exc).alreadyExists) {
				(<FileException> exc).path = newPath;
			} else if ((<FileException> exc).notDirectory) {
				(<FileException> exc).path = newPath;
			}
			throw exc;
		}
	}

	async versionedGetByteSink(path: string, create = true, exclusive = false):
			Promise<{ sink: ByteSink; version: number; }> {
		let f = await this.getOrCreateFile(path, create, exclusive);
		return f.writeSink();
	}

	async getByteSink(path: string, create = true, exclusive = false):
			Promise<ByteSink> {
		let { sink } = await this.versionedGetByteSink(path, create, exclusive);
		return sink;
	}

	async versionedGetByteSource(path: string):
			Promise<{ src: ByteSource; version: number; }> {
		let f = await this.getOrCreateFile(path, false, false);
		return f.readSrc();
	}

	async getByteSource(path: string): Promise<ByteSource> {
		let { src } = await this.versionedGetByteSource(path);
		return src;
	}

	async statFile(path: string): Promise<FileStats> {
		let f = await this.getOrCreateFile(path, false, false);
		let { src, version } = await f.readSrc();
		let stat: FileStats = {
			size: await src.getSize(),
			version
		};
		return stat;
	}

	async checkFolderPresence(path: string, throwIfMissing = false):
			Promise<boolean> {
		let folderPath = splitPathIntoParts(path);
		let f = await this.root.getFolderInThisSubTree(folderPath, false)
		.catch(setExcPath(path))
		.catch((exc: FileException) => {
			if (exc.notFound && !throwIfMissing) { return; }
			throw exc;
		});
		return !!f;
	}
	
	async checkFilePresence(path: string, throwIfMissing?: boolean):
			Promise<boolean> {
		let f = await this.getOrCreateFile(path, false, false)
		.catch(setExcPath(path))
		.catch((exc: FileException) => {
			if (exc.notFound && !throwIfMissing) { return; }
			throw exc;
		});
		return !!f;
	}

	async copyFolder(src: string, dst: string, mergeAndOverwrite = false):
			Promise<void> {
		let lst = await this.listFolder(src);
		await this.makeFolder(dst, !mergeAndOverwrite);
		for (let f of lst) {
			if (f.isFile) {
				await this.copyFile(`${src}/${f.name}`, `${dst}/${f.name}`,
					mergeAndOverwrite);
			} else if (f.isFolder) {
				await this.copyFolder(`${src}/${f.name}`, `${dst}/${f.name}`,
					mergeAndOverwrite);
			} else if (f.isLink) {
				let link = await this.readLink(f.name);
				let t = await link.target<File|StorageFS>();
				await this.link(`${dst}/${f.name}`, t);
			}
		}
	}

	async saveFolder(folder: StorageFS, dst: string,
			mergeAndOverwrite = false): Promise<void> {
		let lst = await folder.listFolder('/');
		await this.makeFolder(dst, !mergeAndOverwrite);
		for (let f of lst) {
			if (f.isFile) {
				let src = await folder.getByteSource(f.name);
				let sink = await this.getByteSink(dst, true, !mergeAndOverwrite);
				await pipe(src, sink);
			} else if (f.isFolder) {
				let subFolder = await folder.readonlySubRoot(f.name);
				await this.saveFolder(subFolder, `${dst}/${f.name}`,
					mergeAndOverwrite);
			} else if (f.isLink) {
				let link = await this.readLink(f.name);
				let t = await link.target<File|StorageFS>();
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

	async link(path: string, target: File | StorageFS):
			Promise<void> {
		if (!target ||
				(typeof (<Linkable> <any> target).getLinkParams !== 'function')) {
			throw new Error('Given target is not-linkable');
		}
		let params = await (<Linkable> <any> target).getLinkParams();
		this.ensureLinkingAllowedTo(params);
		await this.root.createLink(path, params);
	}

	async readLink(path: string): Promise<SymLink> {
		let { fileName, folderPath } = split(path);
		let folder = await this.root.getFolderInThisSubTree(folderPath)
		.catch(setExcPath(path));
		let link = await folder.getLink(fileName)
		.catch(setExcPath(path));
		return await link!.read();
	}

	async getLinkParams(): Promise<LinkParameters<any>> {
		let linkParams = this.root.getParamsForLink();
		linkParams.params.folderName = this.name;
		linkParams.readonly = !this.writable;
		return linkParams;
	}

	static async makeFolderFromLinkParams(storage: Storage,
			params: LinkParameters<FolderLinkParams>):
			Promise<web3n.storage.FS> {
		let name = params.params.folderName;
		let writable = !params.readonly;
		let fs = new FS(storage, writable, name);
		fs.root = await FolderNode.makeForLinkParams(storage, params.params);
		return Object.freeze(wrapFSImplementation(fs));
	}
	
	protected async makeFileObject(path: string, exists: boolean,
			writable: boolean): Promise<File> {
		if (exists) {
			let fNode = await this.getOrCreateFile(path, false, false);
			return FileObject.makeExisting(fNode, writable);
		} else {
			let name = basename(path);
			return FileObject.makeForNotExisiting(name, (): Promise<FileNode> => {
				return this.getOrCreateFile(path, true, true);
			});
		}
	}

}
Object.freeze(FS.prototype);
Object.freeze(FS);

Object.freeze(exports);