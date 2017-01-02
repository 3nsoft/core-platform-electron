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
 * reliance set.
 */

import * as random from '../../random-node';
import { arrays, secret_box as sbox } from 'ecma-nacl';
import { FileKeyHolder, makeFileKeyHolder, makeNewFileKeyHolder, makeHolderFor }
	from 'xsp-files';
import { utf8 } from '../../../lib-common/buffer-utils';
import { ByteSink, ByteSource }
	from '../../../lib-common/byte-streaming/common';
import { ObjSink } from '../../../lib-common/obj-streaming/common';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { makeDecryptedByteSource, makeObjByteSourceFromArrays }
	from '../../../lib-common/obj-streaming/crypto';
import { makeFileException, Code as excCode, FileException }
	from '../../../lib-common/exceptions/file';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { ListingEntry, Storage } from './common';
import { FS } from './fs';
import { NodeInFS, NodeCrypto, SEG_SIZE, SymLink } from './node-in-fs';
import { FileNode } from './file-node';
import { LinkNode } from './link-node';
import { LinkParameters } from '../../files';
import { base64 } from '../../../lib-common/buffer-utils';
import { StorageException } from '../exceptions';
import { defer, Deferred } from '../../../lib-common/processes';

export interface NodeJson {
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
	/**
	 * If this field is present and is true, it indicates that entity is a
	 * symbolic link.
	 */
	isLink?: boolean;
}

export interface FolderJson {
	nodes: {
		[name: string]: NodeJson;
	};
}

class FolderCrypto extends NodeCrypto {
	
	private mkey: Uint8Array = (undefined  as any);
	private mkeyDecr: sbox.Decryptor = (undefined  as any);
	
	constructor(keyHolder: FileKeyHolder) {
		super(keyHolder);
		Object.seal(this);
	}
	
	static makeForNewFolder(parentEnc: sbox.Encryptor): FolderCrypto {
		let keyHolder = makeNewFileKeyHolder(
			parentEnc, random.bytes, NodeCrypto.arrFactory);
		let fc = new FolderCrypto(keyHolder);
		fc.mkey = random.bytes(sbox.KEY_LENGTH);
		return fc;
	}

	static makeReadonly(mkey: Uint8Array): FolderCrypto {
		let fc = new FolderCrypto(undefined as any);
		fc.mkey = mkey;
		return fc;
	}
	
	/**
	 * @param parentDecr
	 * @param objSrc
	 * @param arrFactory
	 * @return folder crypto object with null mkey, which should be set
	 * somewhere else.
	 */
	static async makeForExistingFolder(parentDecr: sbox.Decryptor,
			objSrc: ObjSource):
			Promise<{ crypto: FolderCrypto; folderJson: FolderJson; }> {
		let keyHolder: FileKeyHolder = (undefined as any);
		let byteSrc = await makeDecryptedByteSource(objSrc,
			(header: Uint8Array) => {
				keyHolder = makeFileKeyHolder(parentDecr, header,
					NodeCrypto.arrFactory);
				return keyHolder.segReader(header);
			});
		let bytes = await byteSrc.read(undefined);
		if (!bytes) { throw new Error(`Expected object ${objSrc.getObjVersion()} to non-empty`); }
		let fc = new FolderCrypto(keyHolder);
		let folderJson = fc.setMKeyAndParseRestOfBytes(bytes)
		return { crypto: fc, folderJson: folderJson };
	}
	
	/**
	 * This packs folder's binary object.
	 * Structure of this object is following: master-key bytes, followed by
	 * folder-json structure.
	 */
	pack(json: FolderJson, version: number): ObjSource {
		if (!this.keyHolder) { throw new Error("Cannot use wiped object."); }
		let segWriter = this.keyHolder.newSegWriter(SEG_SIZE, random.bytes);
		let completeContent = [ this.mkey, utf8.pack(JSON.stringify(json)) ];
		let objSrc = makeObjByteSourceFromArrays(
			completeContent, segWriter, version);
		segWriter.destroy();
		return objSrc;
	}
	
	private setMKeyAndParseRestOfBytes(bytes: Uint8Array): FolderJson {
		if (bytes.length < sbox.KEY_LENGTH) {
			throw new Error("Too few bytes folder object.");
		}
		let mkeyPart = bytes.subarray(0, sbox.KEY_LENGTH);
		this.mkey = new Uint8Array(mkeyPart);
		arrays.wipe(mkeyPart);
		return JSON.parse(utf8.open(bytes.subarray(sbox.KEY_LENGTH)));
	}
	
	childMasterDecr(): sbox.Decryptor {
		if (!this.mkey) { throw new Error("Master key is not set."); }
		if (!this.mkeyDecr) {
			this.mkeyDecr = sbox.formatWN.makeDecryptor(this.mkey, this.arrFactory);
		}
		return this.mkeyDecr;
	}
	
	childMasterEncr(): sbox.Encryptor {
		if (!this.mkey) { throw new Error("Master key is not set."); }
		return sbox.formatWN.makeEncryptor(
			this.mkey, random.bytes(sbox.NONCE_LENGTH), 1, this.arrFactory);
	}
	
	async openAndSetFrom(src: ObjSource): Promise<FolderJson> {
		if (!this.keyHolder) { throw new Error("Cannot use wiped object."); }
		let byteSrc = await makeDecryptedByteSource(
			src, this.keyHolder.segReader);
		let bytes = await byteSrc.read(undefined)
		if (!bytes) { throw new Error(`Expected object ${src.getObjVersion()} to non-empty`); }
		return this.setMKeyAndParseRestOfBytes(bytes);
	}
	
	wipe(): void {
		super.wipe();
		if (this.mkey) {
			arrays.wipe(this.mkey);
			this.mkey = (undefined as any);
		}
		if (this.mkeyDecr) {
			this.mkeyDecr.destroy();
			this.mkeyDecr = (undefined as any);
		}
	}
	
	clone(arrFactory: arrays.Factory): FolderCrypto {
		let fc = new FolderCrypto(this.keyHolder.clone(arrFactory));
		if (this.mkey) {
			fc.mkey = new Uint8Array(this.mkey);
		}
		return fc;
	}
	
}
Object.freeze(FolderCrypto.prototype);
Object.freeze(FolderCrypto);

function makeFileJson(objId: string, name: string): NodeJson {
	let f: NodeJson = {
		name: name,
		objId: objId
	};
	return f;
}

export interface FolderLinkParams {
	folderName: string;
	objId: string;
	fKey: string;
}

export class FolderNode extends NodeInFS<FolderCrypto> {
	
	private folderJson: FolderJson = (undefined as any);
	
	private constructor(storage: Storage, name: string|undefined, objId: string,
			version: number|undefined, parentId: string|undefined) {
		super(storage, 'folder', name!, objId, version, parentId);
		if (!name && (objId || parentId)) {
			throw new Error("Root folder must "+
				"have both objId and parent as nulls.");
		} else if (objId === null) {
			new Error("Missing objId for non-root folder");
		}
		Object.seal(this);
	}
	
	static newRoot(fs: FS, masterEnc: sbox.Encryptor): FolderNode {
		let rf = new FolderNode(fs.storage, (undefined as any), (null as any), undefined, undefined);
		rf.setEmptyFolderJson();
		rf.crypto = FolderCrypto.makeForNewFolder(masterEnc);
		fs.storage.nodes.set(rf);
		rf.save();
		return rf;
	}
	
	static async rootFromObjBytes(fs: FS, name: string|undefined, objId: string,
			src: ObjSource, masterDecr: sbox.Decryptor):
			Promise<FolderNode> {
		let version = src.getObjVersion();
		let rf = new FolderNode(fs.storage, name, objId, version, undefined);
		let partsForInit = await FolderCrypto.makeForExistingFolder(
			masterDecr, src);
		rf.crypto = partsForInit.crypto;
		rf.setFolderJson(partsForInit.folderJson);
		fs.storage.nodes.set(rf);
		return rf;
	}

	static async makeForLinkParams(storage: Storage, params: FolderLinkParams):
			Promise<FolderNode> {
		let src = await storage.getObj(params.objId);
		let fileHeader = await src.readHeader();
		let keyHolder = makeHolderFor(base64.open(params.fKey), fileHeader);
		let f = new FolderNode(storage, params.folderName, params.objId,
			src.getObjVersion(), undefined);
		f.crypto = new FolderCrypto(keyHolder);
		f.crypto.openAndSetFrom(src);
		let existingNode = storage.nodes.get(f.objId);
		if (existingNode) {
			// note, that, although we return existing folder node, above crypto
			// operations ensure that link parameters are valid
			return (existingNode as FolderNode);
		} else {
			storage.nodes.set(f);
			return f;
		}
	}

	static rootFromJSON(storage: Storage, name: string|undefined,
			folderJson: FolderJson, mkey: string): FolderNode {
		let f = new FolderNode(storage, name, null!, undefined, undefined);
		let k = base64.open(mkey);
		f.crypto = FolderCrypto.makeReadonly(k);
		f.folderJson = folderJson;
		storage.nodes.set(f);
		return f;
	}
	
	private registerInFolderJson(f: NodeInFS<NodeCrypto>): void {
		let fj: NodeJson = {
			name: f.name,
			objId: f.objId,
		};
		if (f.type === 'folder') { fj.isFolder = true; }
		else if (f.type === 'file') { fj.isFile = true; }
		else if (f.type === 'link') { fj.isLink = true; }
		else { throw new Error(`Unknown type of file system entity: ${f.type}`); }
		this.folderJson.nodes[fj.name] = fj;
	}
	
	private deregisterInFolderJson(f: NodeInFS<NodeCrypto>): void {
		delete this.folderJson.nodes[f.name];
	}
	
	list(): { lst: ListingEntry[]; version: number; } {
		let names = Object.keys(this.folderJson.nodes);
		let lst: ListingEntry[] = new Array(names.length);
		for (let i=0; i < names.length; i+=1) {
			let entity = this.folderJson.nodes[names[i]];
			let info: ListingEntry = { name: entity.name };
			if (entity.isFolder) { info.isFolder = true; }
			else if (entity.isFile) { info.isFile = true }
			else if (entity.isLink) { info.isLink = true }
			lst[i] = info;
		}
		return { lst, version: this.version };
	}
	
	listFolders(): string[] {
		return Object.keys(this.folderJson.nodes).filter((name) => {
			return !!this.folderJson.nodes[name].isFolder;
		});
	}
	
	private getFileJson(name: string, undefOnMissing = false):
			NodeJson|undefined {
		let fj = this.folderJson.nodes[name];
		if (fj) {
			return fj;
		} else if (undefOnMissing) {
			return;
		} else {
			throw makeFileException(excCode.notFound, name);
		}
	}

	hasChild(childName: string, throwIfMissing = false): boolean {
		return !!this.getFileJson(childName, !throwIfMissing);
	}

	private fixMissingChildAndThrow(exc: StorageException, childInfo: NodeJson):
			never {
		delete this.folderJson.nodes[childInfo.name];
		this.save();
		let fileExc = makeFileException(excCode.notFound, childInfo.name, exc);
		fileExc.inconsistentStateOfFS = true;
		throw fileExc;
	}

	/**
	 * @param objId
	 * @return either node (promise for node), or a deferred, which promise has
	 * been registered under a given id, and, therefore, has to be resolved with
	 * node.
	 */
	private getNodeOrArrangePromise<T extends NodeInFS<NodeCrypto>>(
			objId: string):
			{ nodeOrPromise?: T|Promise<T>, deferred?: Deferred<T> } {
		let { node, nodePromise } =
			this.storage.nodes.getNodeOrPromise<T>(objId);
		if (node) { return { nodeOrPromise: node }; }
		if (nodePromise) { return { nodeOrPromise: nodePromise }; }
		let deferred = defer<T>();
		this.storage.nodes.setPromise(objId, deferred.promise);
		return { deferred };
	}

	async getFolder(name: string, undefOnMissing = false):
			Promise<FolderNode|undefined> {
		let childInfo = this.getFileJson(name, undefOnMissing);
		if (!childInfo) { return; }
		if (!childInfo.isFolder) {
			throw makeFileException(excCode.notDirectory, childInfo.name); }
		if (Array.isArray(childInfo.objId)) {
			throw new Error("This implementation does not support "+
				"folders, spread over several objects.");
		}
		let { nodeOrPromise: child, deferred } =
			this.getNodeOrArrangePromise<FolderNode>(childInfo.objId);
		if (child) { 
			return child; }
		try {
			let src = await this.storage.getObj(childInfo.objId);
			let partsForInit = await FolderCrypto.makeForExistingFolder(
				this.crypto.childMasterDecr(), src);
			let f = new FolderNode(this.storage, childInfo.name,
				childInfo.objId, src.getObjVersion(), this.objId);
			f.crypto = partsForInit.crypto;
			f.setFolderJson(partsForInit.folderJson);
			deferred!.resolve(f);
			return f;
		} catch (exc) {
			deferred!.reject(exc);
			if (exc.objNotFound) { this.fixMissingChildAndThrow(exc, childInfo); }
			throw errWithCause(exc, `Cannot instantiate folder node '${this.name}/${childInfo.name}' from obj ${childInfo.objId}`);
		}
	}
	
	async getFile(name: string, undefOnMissing = false):
			Promise<FileNode|undefined> {
		let childInfo = this.getFileJson(name, undefOnMissing);
		if (!childInfo) { return; }
		if (!childInfo.isFile) { throw makeFileException(
			excCode.notFile, childInfo.name); }
		if (Array.isArray(childInfo.objId)) {
			throw new Error("This implementation does not support "+
				"files, spread over several objects.");
		}
		let { nodeOrPromise: child, deferred } =
			this.getNodeOrArrangePromise<FileNode>(childInfo.objId);
		if (child) { return child; }
		try {
			let f = await FileNode.makeForExisting(this.storage, this.objId, name,
					this.crypto.childMasterDecr(), childInfo.objId);
			deferred!.resolve(f);
			return f;
		} catch (exc) {
			deferred!.reject(exc);
			if (exc.objNotFound) { this.fixMissingChildAndThrow(exc, childInfo); }
			throw errWithCause(exc, `Cannot instantiate file node '${this.name}/${childInfo.name}'`);
		}
	}
	
	async getLink(name: string, undefOnMissing = false):
			Promise<LinkNode|undefined> {
		let childInfo = this.getFileJson(name, undefOnMissing);
		if (!childInfo) { return; }
		if (!childInfo.isLink) { throw makeFileException(
			excCode.notLink, childInfo.name); }
		if (Array.isArray(childInfo.objId)) {
			throw new Error("This implementation does not support "+
				"links, spread over several objects.");
		}
		let { nodeOrPromise: child, deferred } =
			this.getNodeOrArrangePromise<LinkNode>(childInfo.objId);
		if (child) { return child; }
		try {
			let l = await LinkNode.makeForExisting(this.storage, this.objId, name,
				this.crypto.childMasterDecr(), childInfo.objId);
			deferred!.resolve(l);
			return l;
		} catch (exc) {
			deferred!.reject(exc);
			if (exc.objNotFound) { this.fixMissingChildAndThrow(exc, childInfo); }
			throw errWithCause(exc, `Cannot instantiate link node '${this.name}/${childInfo.name}'`);
		}
	}
	
	createFolder(name: string): FolderNode {
		if (this.getFileJson(name, true)) {
			throw makeFileException(excCode.alreadyExists, name); }
		let f = new FolderNode(this.storage, name,
			this.storage.generateNewObjId(), undefined, this.objId);
		f.setEmptyFolderJson();
		// Always new encryptor gets random nonce.
		//	Reusing encryptor will leave related nonces, exposing files in the
		// same folder.
		let childMasterEncr = this.crypto.childMasterEncr();
		f.crypto = FolderCrypto.makeForNewFolder(childMasterEncr);
		childMasterEncr.destroy();
		this.registerInFolderJson(f);
		this.storage.nodes.set(f);
		f.save();
		this.save();
		return f;
	}
	
	createFile(name: string): FileNode {
		if (this.getFileJson(name, true)) {
			throw makeFileException(excCode.alreadyExists, name); }
		// Always new encryptor gets random nonce.
		//	Reusing encryptor will leave related nonces, exposing files in the
		// same folder.
		let childMasterEncr = this.crypto.childMasterEncr();
		let f = FileNode.makeForNew(this.storage, this.objId, name,
			childMasterEncr);
		childMasterEncr.destroy();
		this.registerInFolderJson(f);
		this.storage.nodes.set(f);
		f.save([]);
		this.save();
		return f;
	}

	createLink(name: string, params: LinkParameters<FolderLinkParams>): void {
		if (this.getFileJson(name, true)) {
			throw makeFileException(excCode.alreadyExists, name); }
		// Always new encryptor gets random nonce.
		//	Reusing encryptor will leave related nonces, exposing files in the
		// same folder.
		let childMasterEncr = this.crypto.childMasterEncr();
		let l = LinkNode.makeForNew(this.storage, this.objId, name,
			childMasterEncr);
		childMasterEncr.destroy();
		this.registerInFolderJson(l);
		this.storage.nodes.set(l);
		l.setLinkParams(params);
		this.save();
	}
	
	removeChild(f: NodeInFS<NodeCrypto>): void {
		let childJSON = this.folderJson.nodes[f.name];
		if (!childJSON || (childJSON.objId !== f.objId)) { throw new Error(
			`Not a child given: name==${f.name}, objId==${f.objId}, parentId==${f.parentId}, this folder objId==${this.objId}`); }
		this.deregisterInFolderJson(f);
		this.storage.nodes.delete(f);
		this.storage.removeObj(f.objId);
		this.save();
	}
	
	async moveChildTo(childName: string, dst: FolderNode, nameInDst: string):
			Promise<void> {
		let childJSON = this.getFileJson(childName)!;
		if (Array.isArray(childJSON.objId)) {
			throw new Error("This implementation does not support "+
				"links, spread over several objects.");
		}
		if (dst.hasChild(nameInDst)) {
			throw makeFileException(excCode.alreadyExists, nameInDst); }
		if (dst === this) {
			// In this case we only need to change child's name
			delete this.folderJson.nodes[childName];
			this.folderJson.nodes[nameInDst] = childJSON;
			childJSON.name = nameInDst;
			let child = this.storage.nodes.get(childJSON.objId);
			if (child) {
				child.name = nameInDst;
			}
			this.save();
			return;
		}
		let child: NodeInFS<NodeCrypto>;
		if (childJSON.isFolder) {
			child = (await this.getFolder(childName))!;
		} else if (childJSON.isFile) {
			child = (await this.getFile(childName))!;
		} else if (childJSON.isLink) {
			child = (await this.getLink(childName))!;
		} else {
			throw new Error(`Unknown fs node type ${JSON.stringify(childJSON)}`);
		}
		await child.reencryptAndSave(dst.crypto.childMasterEncr());
		delete this.folderJson.nodes[childName];
		dst.folderJson.nodes[nameInDst] = childJSON;
		childJSON.name = nameInDst;
		child.name = nameInDst;
		child.parentId = dst.objId;
		this.save();
		dst.save();
	}
	
	async getFolderInThisSubTree(path: string[], createIfMissing = false,
			exclusiveCreate = false): Promise<FolderNode> {
		if (path.length === 0) { return this; }
		let f: FolderNode;
		try {
			f = (await this.getFolder(path[0]))!;
			// existing folder at this point
			if (path.length === 1) {
				if (exclusiveCreate) {
					throw makeFileException(excCode.alreadyExists, path[0]);
				} else {
					return f;
				}
			}
		} catch (err) {
			if (!(<FileException> err).notFound) { throw err; }
			if (!createIfMissing) { throw err; }
			try {
				f = this.createFolder(path[0]);
			} catch (exc) {
				if ((<FileException> exc).alreadyExists && !exclusiveCreate) {
					return this.getFolderInThisSubTree(path, createIfMissing);
				} 
				throw exc;
			}
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
		return this.storage.saveObj(this.objId, src);
	}
	
	private setEmptyFolderJson(): void {
		this.folderJson = {
			nodes: {}
		};
	}
	
	private setFolderJson(folderJson: FolderJson): void {
		// TODO sanitize folderJson before using it
		
		this.folderJson = folderJson;
	}
	
	async update(encrSrc: ObjSource): Promise<void> {
		let src = await this.storage.getObj(this.objId);
		let folderJson = await this.crypto.openAndSetFrom(src);
		this.version = src.getObjVersion()!;
		this.setFolderJson(folderJson);
	}
	
	remove(): void {
		if (Object.keys(this.folderJson.nodes).length > 0) {
			throw makeFileException(excCode.notEmpty, this.name);
		}
		let p = this.getParent();
		if (!p) { throw new Error('Cannot remove root folder'); }
		p.removeChild(this);
	}

	getParamsForLink(): LinkParameters<FolderLinkParams> {
		if ((this.storage.type !== 'synced') && (this.storage.type !== 'local')) {
			throw new Error(`Creating link parameters to object in ${this.storage.type} file system, is not implemented.`); }
		let params: FolderLinkParams = {
			folderName: (undefined as any),
			objId: this.objId,
			fKey: this.crypto.fileKeyInBase64()
		};
		let linkParams: LinkParameters<FolderLinkParams> = {
			storageType: this.storage.type,
			isFolder: true,
			params
		};
		return linkParams;
	}
	
}
Object.freeze(FolderNode.prototype);
Object.freeze(FolderNode);

Object.freeze(exports);