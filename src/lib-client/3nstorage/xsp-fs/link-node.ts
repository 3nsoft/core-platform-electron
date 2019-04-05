/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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

import { NodeInFS, NodeCrypto } from './node-in-fs';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { idToHeaderNonce }
	from '../../../lib-common/obj-streaming/crypto';
import { utf8 } from '../../../lib-common/buffer-utils';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { LinkParameters } from '../../files';
import { DeviceFS } from '../../local-files/device-fs';
import { FileLinkParams } from './file-node';
import { FolderLinkParams } from './folder-node';
import { Storage, AsyncSBoxCryptor } from './common';
import { FileObject } from './file';
import { XspFS } from './fs';

class LinkCrypto extends NodeCrypto {
	
	constructor(zNonce: Uint8Array, key: Uint8Array, cryptor: AsyncSBoxCryptor) {
		super(zNonce, key, cryptor);
		Object.seal(this);
	}
	
	async readLinkParams(src: ObjSource): Promise<LinkParameters<any>> {
		try {
			return JSON.parse(utf8.open(await this.openBytes(src)));
		} catch (exc) {
			throw errWithCause(exc, `Cannot open link object`);
		}
	}
}
Object.freeze(LinkCrypto.prototype);
Object.freeze(LinkCrypto);

type Transferable = web3n.implementation.Transferable;
type SymLink = web3n.files.SymLink;

function makeFileSymLink(storage: Storage,
		params: LinkParameters<FileLinkParams>): SymLink {
	const sl: SymLink = {
		isFile: true,
		readonly: !!params.readonly,
		target: () => FileObject.makeFileFromLinkParams(storage, params)
	};
	(sl as any as Transferable).$_transferrable_type_id_$ = 'SimpleObject';
	return Object.freeze(sl);
}

function makeFolderSymLink(storage: Storage,
		params: LinkParameters<FolderLinkParams>): SymLink {
	const sl: SymLink = {
		isFolder: true,
		readonly: !!params.readonly,
		target: () => XspFS.makeFolderFromLinkParams(storage, params)
	};
	(sl as any as Transferable).$_transferrable_type_id_$ = 'SimpleObject';
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
			objId: string, version: number, parentId: string|undefined,
			key: Uint8Array) {
		super(storage, 'link', name, objId, version, parentId);
		if (!name || !objId || !parentId) { throw new Error(
			"Bad link parameter(s) given"); }
		this.crypto = new LinkCrypto(
			idToHeaderNonce(this.objId), key, this.storage.cryptor);
		Object.seal(this);
	}

	static makeForNew(storage: Storage, parentId: string, name: string,
			key: Uint8Array): LinkNode {
		const objId = storage.generateNewObjId();
		return new LinkNode(storage, name, objId, 0, parentId, key);
	}

	static async makeForExisting(storage: Storage, parentId: string,
			name: string, objId: string, key: Uint8Array):
			Promise<LinkNode> {
		const src = await storage.getObj(objId);
		return  new LinkNode(storage, name, objId, src.version, parentId, key);
	}

	async setLinkParams(params: LinkParameters<any>): Promise<void> {
		if (this.linkParams) { throw new Error(
			'Cannot set link parameters second time'); }
		return this.doChange(false, async () => {
			const newVersion = this.version + 1;
			this.linkParams = params;
			const bytes = utf8.pack(JSON.stringify(params));
			const src = await this.crypto.packBytes(bytes, newVersion);
			await this.storage.saveObj(this.objId, src);
			this.setCurrentVersion(newVersion);
		});
	}

	private async getLinkParams(): Promise<LinkParameters<any>> {
		if (!this.linkParams) {
			await this.doChange(false, async () => {
				const objSrc = await this.storage.getObj(this.objId);
				this.linkParams = await this.crypto.readLinkParams(objSrc);
				this.setCurrentVersion(objSrc.version);
			});
		}
		return this.linkParams;
	}

	async read(): Promise<SymLink> {
		const params = await this.getLinkParams();
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
			const storage = this.storage.storageForLinking('share');
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
			const storage = this.storage.storageForLinking('synced');
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