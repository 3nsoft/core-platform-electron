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
 * reliance set, exposing to outside only folder's wrap.
 */

import { makeFileException, Code as excCode, FileException }
	from '../../../lib-common/exceptions/file';
import { secret_box as sbox } from 'ecma-nacl';
import { ByteSource, ByteSink }
	from '../../../lib-common/byte-streaming/common';
import { ObjSource }
	from '../../../lib-common/obj-streaming/common';
import { SinkBackedObjSource } from '../../../lib-common/obj-streaming/pipe';
import { FS } from './fs';
import { FolderCrypto, FileCrypto, EntityCrypto } from './fs-crypto';
import { ListingEntry } from './common';

abstract class FSEntity {
	
	crypto: EntityCrypto = null;
	version = 0;
	
	constructor(
			protected fs: FS,
			public name: string,
			public objId: string,
			version: number,
			public parentId: string) {
		if (typeof version === 'number') { this.version = version; }
	}
	
	getParent(): Folder {
		return <Folder> this.fs.objs.get(this.parentId);
	}

	async reencryptAndSave(fKeyEncr: sbox.Encryptor): Promise<void> {
		let src = await this.fs.storage.getObj(this.objId);
		let header = await src.readHeader();
		header = this.crypto.reencryptTo(fKeyEncr, header);
		this.version += 1;
		return this.fs.storage.saveNewHeader(this.objId, this.version, header);
	}
	
}

export class File extends FSEntity {

	crypto: FileCrypto = null;
	
	constructor(fs: FS, name: string,
			objId: string, version: number, parentId: string) {
		super(fs, name, objId, version, parentId);
		if (!name || !objId || !parentId) { throw new Error(
			"Bad file parameter(s) given"); }
		Object.seal(this);
	}
	
	async readSrc(): Promise<ByteSource> {
		let objSrc = await this.fs.storage.getObj(this.objId);
		this.version = objSrc.getObjVersion();
		return this.crypto.decryptedBytesSource(objSrc);
	}
	
	// XXX why is there a writeCompletion? do we use/need it?
	//		shouldn't sink.write(null) be good enough for write completion?
	writeSink(): { sink: ByteSink; writeCompletion: Promise<void>; } {
		let pipe = new SinkBackedObjSource();
		return {
			sink: this.crypto.encryptingByteSink(pipe.getSink()),
			writeCompletion: this.fs.storage.saveObj(this.objId, pipe.getSource())
		}
	}
	
	save(bytes: Uint8Array|Uint8Array[]): Promise<void> {
		this.version += 1;
		let src = this.crypto.pack(bytes, this.version);
		return this.fs.storage.saveObj(this.objId, src);
	}
	
	remove(): void {
		this.getParent().removeChild(this);
	}
	
}
Object.freeze(File.prototype);
Object.freeze(File);

export interface FileJson {
	/**
	 * This is a usual file name.
	 */
	name: string;
	/**
	 * This is an id of file's object, or an array of ordered objects
	 * that constitute the whole of file.
	 * An array may have specific use case for file editing, and it allows
	 * for a general hiding a big file among smaller ones.
	 */
	objId: string|string[];
	/**
	 * This field is to be used, when extra bytes are added to file content
	 * to hide its size, by making it bigger.
	 */
	contentLen?: number;
	/**
	 * If this field is present and is true, it indicates that entity is a
	 * folder.
	 */
	isFolder?: boolean;
	/**
	 * If this field is present and is true, it indicates that entity is a
	 * file.
	 */
	isFile?: boolean;
}

export interface FolderJson {
	files: {
		[name: string]: FileJson;
	};
}

function makeFileJson(objId: string, name: string): FileJson {
	let f: FileJson = {
		name: name,
		objId: objId
	};
	return f;
}

let EMPTY_BYTE_ARR = new Uint8Array(0);

export class Folder extends FSEntity {
	
	crypto: FolderCrypto = null;
	private folderJson: FolderJson = null;
	
	/**
	 * files field contains only instantiated file and folder objects,
	 * therefore, it should not be used to check existing names in this folder.
	 */
	private files = new Map<string, FSEntity>();
	
	constructor(fs: FS, name: string, objId: string, version: number,
			parentId: string) {
		super(fs, name, objId, version, parentId);
		if (!name && (objId || parentId)) {
			throw new Error("Root folder must "+
				"have both objId and parent as nulls.");
		} else if (objId === null) {
			new Error("Missing objId for non-root folder");
		}
		Object.seal(this);
	}
	
	static newRoot(fs: FS, masterEnc: sbox.Encryptor): Folder {
		let rf = new Folder(fs, null, null, null, null);
		rf.setEmptyFolderJson();
		rf.crypto = FolderCrypto.makeForNewFolder(
			masterEnc, fs.arrFactory);
		rf.save();
		return rf;
	}
	
	static rootFromFolder(fs: FS, f: Folder): Folder {
		if (f.parentId === null) {
			throw new Error("Given folder is already root");
		}
		let rf = new Folder(fs, f.name, f.objId, f.version, null);
		rf.setFolderJson(f.folderJson);
		rf.crypto = f.crypto.clone(fs.arrFactory);
		return rf;
	}
	
	static async rootFromObjBytes(fs: FS, name: string, objId: string,
			src: ObjSource, masterDecr: sbox.Decryptor):
			Promise<Folder> {
		let version = src.getObjVersion();
		let rf = new Folder(fs, name, objId, version, null);
		let partsForInit = await FolderCrypto.makeForExistingFolder(
			masterDecr, src, fs.arrFactory);
		rf.crypto = partsForInit.crypto;
		rf.setFolderJson(partsForInit.folderJson);
		return rf;
	}
	
	private registerInFolderJson(f: Folder|File, isFolder = false): void {
		let fj: FileJson = {
			name: f.name,
			objId: f.objId,
		};
		if (isFolder) { fj.isFolder = true; }
		else { fj.isFile = true; }
		this.folderJson.files[fj.name] = fj;
	}
	
	private deregisterInFolderJson(f: Folder|File): void {
		delete this.folderJson.files[f.name];
	}
	
	private addObj(f: Folder|File): void {
		this.files.set(f.name, f);
		this.fs.objs.set(f.objId, f);
	}
	
	private removeObj(f: Folder|File): void {
		this.files.delete(f.name);
		this.fs.objs.delete(f.objId);
	}
	
	list(): ListingEntry[] {
		let names = Object.keys(this.folderJson.files);
		let ll: ListingEntry[] = new Array(names.length);
		for (let i=0; i < names.length; i+=1) {
			let entity = this.folderJson.files[names[i]];
			let info: ListingEntry = { name: entity.name };
			if (entity.isFolder) { info.isFolder = true; }
			else if (entity.isFile) { info.isFile = true }
			ll[i] = info;
		}
		return ll;
	}
	
	listFolders(): string[] {
		return Object.keys(this.folderJson.files).filter((name) => {
			return !!this.folderJson.files[name].isFolder;
		});
	}
	
	private getFileJson(name: string, nullOnMissing = false): FileJson {
		let fj = this.folderJson.files[name];
		if (fj) {
			return fj;
		} else if (nullOnMissing) {
			return null;
		} else {
			throw makeFileException(excCode.notFound,
				`Child element ${name} is not found in folder ${this.name}`);
		}
	}

	hasChild(childName: string, throwIfMissing = false): boolean {
		return !!this.getFileJson(childName, !throwIfMissing);
	}
	
	async getFolder(name: string, nullOnMissing = false): Promise<Folder> {
		let childInfo = this.getFileJson(name, nullOnMissing);
		if (!childInfo) { return; }
		if (!childInfo.isFolder) {
			throw makeFileException(excCode.notDirectory); }
		let child = <Folder> this.files.get(childInfo.name);
		if (child) { return child; }
		if (Array.isArray(childInfo.objId)) {
			throw new Error("This implementation does not support "+
				"folders, spread over several objects.");
		}
		let src = await this.fs.storage.getObj(<string> childInfo.objId)
		let partsForInit = await FolderCrypto.makeForExistingFolder(
			this.crypto.childMasterDecr(), src, this.fs.arrFactory);
		let f = new Folder(this.fs, childInfo.name,
			<string> childInfo.objId, src.getObjVersion(), this.objId);
		f.crypto = partsForInit.crypto;
		f.setFolderJson(partsForInit.folderJson);
		this.addObj(f);
		return f;
	}
	
	async getFile(name: string, nullOnMissing = false): Promise<File> {
		let childInfo = this.getFileJson(name, nullOnMissing);
		if (!childInfo) { return; }
		if (!childInfo.isFile) { throw makeFileException(excCode.notFile); }
		let child = <File> this.files.get(name);
		if (child) { return child; }
		if (Array.isArray(childInfo.objId)) {
			throw new Error("This implementation does not support "+
				"files, spread over several objects.");
		}
		let src = await this.fs.storage.getObj(<string> childInfo.objId);
		let fileHeader = await src.readHeader();
		let fc = await FileCrypto.makeForExistingFile(
			this.crypto.childMasterDecr(), fileHeader, this.fs.arrFactory);
		let f = new File(this.fs, name,
			<string> childInfo.objId, src.getObjVersion(), this.objId);
		f.crypto = fc;
		this.addObj(f);
		return f;
	}
	
	createFolder(name: string): Folder {
		if (this.getFileJson(name, true)) {
			throw makeFileException(excCode.alreadyExists); }
		let f = new Folder(this.fs, name,
			this.fs.generateNewObjId(), null, this.objId);
		f.setEmptyFolderJson();
		f.crypto = FolderCrypto.makeForNewFolder(
			this.crypto.childMasterEncr(), this.fs.arrFactory);
		this.registerInFolderJson(f, true);
		this.addObj(f);
		f.save();
		this.save();
		return f;
	}
	
	createFile(name: string): File {
		if (this.getFileJson(name, true)) {
			throw makeFileException(excCode.alreadyExists); }
		let f = new File(this.fs, name,
			this.fs.generateNewObjId(), null, this.objId);
		f.crypto = FileCrypto.makeForNewFile(
			this.crypto.childMasterEncr(), this.fs.arrFactory);
		this.registerInFolderJson(f);
		this.addObj(f);
		f.save([]);
		this.save();
		return f;
	}
	
	removeChild(f: File | Folder): void {
		if (this.files.get(f.name) !== f) { throw new Error(
			'Not a child given'); }
		this.deregisterInFolderJson(f);
		this.removeObj(f);
		this.fs.storage.removeObj(f.objId);
		this.save();
	}
	
	async moveChildTo(childName: string, dst: Folder, nameInDst: string):
			Promise<void> {
		let childJSON = this.getFileJson(childName);
		if (dst.hasChild(nameInDst)) {
			throw makeFileException(excCode.alreadyExists); }
		if (dst === this) {
			// In this case we only need to change child's name
			delete this.folderJson.files[childName];
			this.folderJson.files[nameInDst] = childJSON;
			childJSON.name = nameInDst;
			let child = this.files.get(childName);
			if (child) {
				this.files.delete(childName);
				this.files.set(nameInDst, child);
				child.name = nameInDst;
			}
			this.save();
			return;
		}
		let child: FSEntity;
		if (childJSON.isFolder) {
			child = await this.getFolder(childName);
		} else if (childJSON.isFile) {
			child = await this.getFile(childName);
		}
		await child.reencryptAndSave(dst.crypto.childMasterEncr());
		delete this.folderJson.files[childName];
		dst.folderJson.files[nameInDst] = childJSON;
		childJSON.name = nameInDst;
		if (child) {
			this.files.delete(childName);
			dst.files.set(nameInDst, child);
			child.name = nameInDst;
			child.parentId = dst.objId;
		}
		this.save();
		dst.save();
	}
	
	async getFolderInThisSubTree(path: string[], createIfMissing = false,
			exclusiveCreate = false):
			Promise<Folder> {
		if (path.length === 0) { return this; }
		let f: Folder;
		try {
			f = await this.getFolder(path[0]);
			// existing folder at this point
			if (path.length === 1) {
				if (exclusiveCreate) {
					throw makeFileException(excCode.alreadyExists);
				} else {
					return f;
				}
			}
		} catch (err) {
			if (!(<FileException> err).notFound) { throw err; }
			if (!createIfMissing) { throw err; }
			f = await this.createFolder(path[0]);
		}
		if (path.length > 1) {
			return f.getFolderInThisSubTree(path.slice(1),
				createIfMissing, exclusiveCreate);
		} else {
			return f;
		}
	}
	
	save(): Promise<void> {
		this.version += 1;
		let src = this.crypto.pack(this.folderJson, this.version);
		return this.fs.storage.saveObj(this.objId, src);
	}
	
	private setEmptyFolderJson(): void {
		this.folderJson = {
			files: {}
		};
	}
	
	private setFolderJson(folderJson: FolderJson): void {
		// TODO sanitize folderJson before using it
		
		this.folderJson = folderJson;
	}
	
	async update(encrSrc: ObjSource): Promise<void> {
		let src = await this.fs.storage.getObj(this.objId);
		this.version = src.getObjVersion();
		let folderJson = await this.crypto.openAndSetFrom(src);
		this.setFolderJson(folderJson);
	}
	
	remove(): void {
		if (Object.keys(this.folderJson.files).length > 0) {
			throw makeFileException(excCode.notEmpty);
		}
		let p = this.getParent();
		if (!p) { throw new Error('Cannot remove root folder'); }
		p.removeChild(this);
	}
	
}
Object.freeze(Folder.prototype);
Object.freeze(Folder);

Object.freeze(exports);