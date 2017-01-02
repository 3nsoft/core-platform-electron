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

import { FileKeyHolder } from 'xsp-files';
import { secret_box as sbox, arrays } from 'ecma-nacl';
import { FolderNode } from './folder-node';
import { base64 } from '../../../lib-common/buffer-utils';
import { SingleProc, Action } from '../../../lib-common/processes';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { makeObjByteSourceFromArrays }
	from '../../../lib-common/obj-streaming/crypto';
import * as random from '../../random-node';
import { Node, Storage } from './common';

export const SEG_SIZE = 16;	// in 256-byte blocks = 4K in bytes

export type SymLink = web3n.storage.SymLink;

let arrFactory = arrays.makeFactory();

export abstract class NodeCrypto {

	protected static arrFactory = arrFactory;
	protected arrFactory = arrFactory;
	
	protected constructor(
			protected keyHolder: FileKeyHolder) {
	}
	
	wipe(): void {
		if (this.keyHolder) {
			this.keyHolder.destroy();
			this.keyHolder = (undefined as any);
		}
	}

	reencryptTo(fKeyEncr: sbox.Encryptor, header: Uint8Array): Uint8Array {
		return this.keyHolder.reencryptKey(fKeyEncr, header);
	}

	fileKeyInBase64(): string {
		if (!this.keyHolder) { throw new Error("Cannot use wiped object."); }
		return base64.pack(this.keyHolder.getKey());
	}
	
	packBytes(bytes: Uint8Array|Uint8Array[], version: number):
			ObjSource {
		if (!this.keyHolder) { throw new Error("Cannot use wiped object."); }
		let segWriter = this.keyHolder.newSegWriter(SEG_SIZE, random.bytes);
		let objSrc = makeObjByteSourceFromArrays(bytes, segWriter, version);
		segWriter.destroy();
		return objSrc;
	}

}
Object.freeze(NodeCrypto.prototype);
Object.freeze(NodeCrypto);

export interface WriteChainingResult {
	newVersion: number;
	completion: Promise<number>;
}

export interface WriteOpeartion {
	(newVersion: number): Promise<void>;
}

export abstract class NodeInFS<TCrypto extends NodeCrypto>
		implements Node {
	
	protected crypto: TCrypto = (undefined as any);
	private writeProc: SingleProc<number>|undefined = undefined;
	private nextVersion = 1;
	version = 0;
	
	protected constructor(
			protected storage: Storage,
			public type: 'file' | 'link' | 'folder',
			public name: string,
			public objId: string,
			version: number | undefined,
			public parentId: string | undefined) {
		if (typeof version === 'number') {
			this.version = version;
			this.nextVersion = this.version + 1;
		}
	}
	
	getParent(): FolderNode {
		return <FolderNode> this.storage.nodes.get(this.parentId!);
	}
	
	remove(): void {
		this.getParent().removeChild(this);
	}

	async reencryptAndSave(fKeyEncr: sbox.Encryptor): Promise<void> {
		let src = await this.storage.getObj(this.objId);
		let header = await src.readHeader();
		header = this.crypto.reencryptTo(fKeyEncr, header);
		this.version += 1;
		return this.storage.saveNewHeader(this.objId, this.version, header);
	}
	
	protected chainWrite(writeOp: WriteOpeartion): WriteChainingResult {
		if (!this.writeProc) {
			this.writeProc = new SingleProc<number>();
		}
		let newVersion = this.nextVersion;
		this.nextVersion += 1;
		let completion = this.writeProc.startOrChain(async () => {
			await writeOp(newVersion);
			this.version = newVersion;
			return this.version;
		});
		return { newVersion, completion };
	}
	
	protected saveBytes(bytes: Uint8Array|Uint8Array[]): WriteChainingResult {
		return this.chainWrite(async (newVersion: number) => {
			let src = this.crypto.packBytes(bytes, newVersion);
			await this.storage.saveObj(this.objId, src);
		});
	}

}
Object.freeze(NodeInFS.prototype);
Object.freeze(NodeInFS);

Object.freeze(exports);