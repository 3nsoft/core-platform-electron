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

/**
 * Everything in this module is assumed to be inside of a file system
 * reliance set.
 */

import * as random from '../../random-node';
import { arrays, secret_box as sbox } from 'ecma-nacl';
import { FileKeyHolder, makeFileKeyHolder, makeNewFileKeyHolder }
	from 'xsp-files';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { makeDecryptedByteSource, makeObjByteSourceFromArrays }
	from '../../../lib-common/obj-streaming/crypto';
import { utf8 } from '../../../lib-common/buffer-utils';
import { NodeInFS, NodeCrypto, SEG_SIZE, SymLink } from './node-in-fs';
import { LinkParameters, File } from '../../files';
import { DeviceFS } from '../../local-files/device-fs';
import { FileLinkParams } from './file-node';
import { FolderLinkParams } from './folder-node';
import { Storage } from './common';
import { FileObject } from './file';
import { FS } from './fs';

class LinkCrypto extends NodeCrypto {
	
	constructor(keyHolder: FileKeyHolder) {
		super(keyHolder);
		Object.seal(this);
	}
	
	static makeForNewLink(parentEnc: sbox.Encryptor,
			arrFactory: arrays.Factory): LinkCrypto {
		let keyHolder = makeNewFileKeyHolder(parentEnc, random.bytes, arrFactory);
		let fc = new LinkCrypto(keyHolder);
		return fc;
	}
	
	/**
	 * @param parentDecr
	 * @param src for the whole xsp object
	 * @param arrFactory
	 * @return link crypto object.
	 */
	static async makeForExistingLink(parentDecr: sbox.Decryptor,
			header: Uint8Array, arrFactory: arrays.Factory): Promise<LinkCrypto> {
		let keyHolder = makeFileKeyHolder(parentDecr, header, arrFactory);
		return new LinkCrypto(keyHolder);
	}
	
	async readLinkParams(src: ObjSource): Promise<LinkParameters<any>> {
		if (!this.keyHolder) { throw new Error("Cannot use wiped object."); }
		let decSrc = await makeDecryptedByteSource(src, this.keyHolder.segReader);
		let bytes = await decSrc.read(undefined);
		if (!bytes) { throw new Error(`Expected object ${src.getObjVersion()} to non-empty`); }
		return JSON.parse(utf8.open(bytes));
	}
	
}
Object.freeze(LinkCrypto.prototype);
Object.freeze(LinkCrypto);

function makeFileSymLink(storage: Storage,
		params: LinkParameters<FileLinkParams>): SymLink {
	let sl: SymLink = {
		isFile: true,
		readonly: !!params.readonly,
		target: async (): Promise<File> => {
			return FileObject.makeFileFromLinkParams(storage, params);
		}
	};
	return Object.freeze(sl);
}

function makeFolderSymLink(storage: Storage,
		params: LinkParameters<FolderLinkParams>): SymLink {
	let sl: SymLink = {
		isFolder: true,
		readonly: !!params.readonly,
		target: async (): Promise<web3n.storage.FS> => {
			return FS.makeFolderFromLinkParams(storage, params);
		}
	};
	return Object.freeze(sl);
}

function makeLinkToStorage(storage: Storage, params: LinkParameters<any>):
		SymLink {
	if (params.isFolder) {
		return makeFolderSymLink(storage, params);
	} else if (params.isFile) {
		return makeFileSymLink(storage, params);
	} else {
		throw new Error(`Invalid link parameters`);
	}
}

export class LinkNode extends NodeInFS<LinkCrypto> {

	private linkParams: any = (undefined as any);
	
	constructor(storage: Storage, name: string,
			objId: string, version: number|undefined, parentId: string) {
		super(storage, 'link', name, objId, version, parentId);
		if (!name || !objId || !parentId) { throw new Error(
			"Bad link parameter(s) given"); }
		Object.seal(this);
	}

	static makeForNew(storage: Storage, parentId: string, name: string,
			masterEncr: sbox.Encryptor): LinkNode {
		let objId = storage.generateNewObjId();
		let l = new LinkNode(storage, name, objId, undefined, parentId);
		let kh = makeNewFileKeyHolder(masterEncr, random.bytes);
		l.crypto = new LinkCrypto(kh);
		return l;
	}

	static async makeForExisting(storage: Storage, parentId: string,
			name: string, masterDecr: sbox.Decryptor, objId: string):
			Promise<LinkNode> {
		let src = await storage.getObj(objId);
		let fileHeader = await src.readHeader();
		let keyHolder = makeFileKeyHolder(masterDecr, fileHeader);
		let l = new LinkNode(storage, name, objId, src.getObjVersion(), parentId);
		l.crypto = new LinkCrypto(keyHolder);
		return l;
	}

	async setLinkParams(params: LinkParameters<any>): Promise<void> {
		if (this.linkParams) { throw new Error(
			'Cannot set link parameters second time'); }
		this.linkParams = params;
		let bytes = utf8.pack(JSON.stringify(params));
		await this.saveBytes(bytes).completion;
	}

	private async getLinkParams(): Promise<LinkParameters<any>> {
		if (!this.linkParams) {
			let objSrc = await this.storage.getObj(this.objId);
			let ver = objSrc.getObjVersion();
			if (typeof ver === 'number') {
				this.version = ver;
			}
			this.linkParams = await this.crypto.readLinkParams(objSrc);
		}
		return this.linkParams;
	}

	async read(): Promise<SymLink> {
		let params = await this.getLinkParams();
		if (params.storageType === 'synced') {
			return this.makeLinkToSyncedStorage(params);
		} else if (params.storageType === 'local') {
			return this.makeLinkToLocalStorage(params);
		} else if (params.storageType === 'device') {
			return this.makeLinkToDevice(params);
		} else if (params.storageType === 'share') {
			return this.makeLinkToSharedStorage(params);
		} else {
			throw new Error(`Link to ${params.storageType} are not implemented.`);
		}
	}

	private makeLinkToSharedStorage(params: LinkParameters<any>): SymLink {
		if (params.storageType === this.storage.type) {
			return makeLinkToStorage(this.storage, params);
		} else if ((this.storage.type === 'local') ||
				(this.storage.type === 'synced')) {
			let storage = this.storage.storageForLinking('share');
			return makeLinkToStorage(storage, params);
		} else {
			throw new Error(`Link to ${params.storageType} storage is not supposed to be present in ${this.storage.type} storage.`);
		}
	}

	private makeLinkToLocalStorage(params: LinkParameters<any>): SymLink {
		if (params.storageType === this.storage.type) {
			return makeLinkToStorage(this.storage, params);
		} else {
			throw new Error(`Link to ${params.storageType} storage is not supposed to be present in ${this.storage.type} storage.`);
		}
	}

	private makeLinkToSyncedStorage(params: LinkParameters<any>): SymLink {
		if (params.storageType === this.storage.type) {
			return makeLinkToStorage(this.storage, params);
		} else if (this.storage.type === 'local') {
			let storage = this.storage.storageForLinking('synced');
			return makeLinkToStorage(storage, params);
		} else {
			throw new Error(`Link to ${params.storageType} storage is not supposed to be present in ${this.storage.type} storage.`);
		}
	}

	private makeLinkToDevice(params: LinkParameters<any>): SymLink {
		if (this.storage.type !== 'local') { throw new Error(
			`Link to ${params.storageType} storage is not supposed to be present in ${this.storage.type} storage.`); }
		if (params.isFolder) {
			return DeviceFS.makeFolderSymLink(params);
		} else if (params.isFile) {
			return DeviceFS.makeFileSymLink(params);
		} else {
			throw new Error(`Invalid link parameters`);
		}
	}
	
}
Object.freeze(LinkNode.prototype);
Object.freeze(LinkNode);

Object.freeze(exports);