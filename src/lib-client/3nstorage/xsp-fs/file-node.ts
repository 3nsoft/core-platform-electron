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
import { ByteSource, ByteSink }
	from '../../../lib-common/byte-streaming/common';
import { ObjSink } from '../../../lib-common/obj-streaming/common';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { SinkBackedObjSource } from '../../../lib-common/obj-streaming/pipe';
import { makeDecryptedByteSource, makeEncryptingByteSink,
	makeObjByteSourceFromArrays }
	from '../../../lib-common/obj-streaming/crypto';
import { syncWrapByteSink, syncWrapByteSource }
	from '../../../lib-common/byte-streaming/concurrent';
import { FS } from './fs';
import { NodeInFS, NodeCrypto, SEG_SIZE, WriteChainingResult }
	from './node-in-fs';
import { LinkParameters } from '../../files';
import { Storage } from './common';
import { base64 } from '../../../lib-common/buffer-utils';

class FileCrypto extends NodeCrypto {
	
	private constructor(keyHolder: FileKeyHolder) {
		super(keyHolder);
		Object.seal(this);
	}
	
	static makeForNew(masterEncr: sbox.Encryptor): FileCrypto {
		let keyHolder = makeNewFileKeyHolder(masterEncr, random.bytes,
			NodeCrypto.arrFactory);
		return new FileCrypto(keyHolder);
	}

	static makeForExisting(masterDecr: sbox.Decryptor, fileHeader: Uint8Array):
			FileCrypto {
		let keyHolder = makeFileKeyHolder(masterDecr, fileHeader,
			NodeCrypto.arrFactory);
		return new FileCrypto(keyHolder);
	}

	static makeFromLinkParam(fKey: string, fileHeader: Uint8Array): FileCrypto {
		let keyHolder = makeHolderFor(base64.open(fKey), fileHeader);
		return new FileCrypto(keyHolder);
	}

	async decryptedBytesSource(src: ObjSource): Promise<ByteSource> {
		if (!this.keyHolder) { throw new Error("Cannot use wiped object."); }
		return syncWrapByteSource(await makeDecryptedByteSource(
			src, this.keyHolder.segReader));
	}
	
	encryptingByteSink(objSink: ObjSink): ByteSink {
		if (!this.keyHolder) { throw new Error("Cannot use wiped object."); }
		return syncWrapByteSink(makeEncryptingByteSink(
			objSink, this.keyHolder.newSegWriter(SEG_SIZE, random.bytes)));
	}
	
}
Object.freeze(FileCrypto.prototype);
Object.freeze(FileCrypto);

export interface FileLinkParams {
	fileName: string;
	objId: string;
	fKey: string;
}

export class FileNode extends NodeInFS<FileCrypto> {

	private constructor(storage: Storage, name: string,
			objId: string, version: number|undefined, parentId: string|undefined) {
		super(storage, 'file', name, objId, version, parentId);
		if (!name || !objId) { throw new Error("Bad file parameter(s) given"); }
		Object.seal(this);
	}

	static makeForNew(storage: Storage, parentId: string, name: string,
			masterEncr: sbox.Encryptor): FileNode {
		if (!parentId) { throw new Error("Bad parent id"); }
		let objId = storage.generateNewObjId();
		let f = new FileNode(storage, name, objId, undefined, parentId);
		f.crypto = FileCrypto.makeForNew(masterEncr);
		return f;
	}

	static async makeForExisting(storage: Storage, parentId: string,
			name: string, masterDecr: sbox.Decryptor, objId: string):
			Promise<FileNode> {
		if ((typeof parentId !== 'string') && (parentId !== null)) {
			throw new Error("Bad parent id"); }
		let src = await storage.getObj(objId);
		let fileHeader = await src.readHeader();
		let f = new FileNode(storage, name, objId, src.getObjVersion(), parentId);
		f.crypto = FileCrypto.makeForExisting(masterDecr, fileHeader);
		return f;
	}

	static async makeForLinkParams(storage: Storage, params: FileLinkParams):
			Promise<FileNode> {
		let src = await storage.getObj(params.objId);
		let fileHeader = await src.readHeader();
		let f = new FileNode(storage, params.fileName, params.objId,
			src.getObjVersion(), undefined);
		f.crypto = FileCrypto.makeFromLinkParam(params.fKey, fileHeader);
		return f;
	}
	
	async readSrc(): Promise<{ src: ByteSource; version: number; }> {
		let objSrc = await this.storage.getObj(this.objId);
		let src = await this.crypto.decryptedBytesSource(objSrc);
		let isVersioned = (this.storage.type === 'synced') ||
			(this.storage.type === 'local');
		if (!isVersioned) {
			return { src, version: (undefined as any) };
		}
		let version = objSrc.getObjVersion();
		if (typeof version !== 'number') { throw new Error(
			`Object source doesn't have defined version`); }
		if (this.version < version) {
			this.version = version;
		}
		return { src, version };
	}

	writeSink(): { sink: ByteSink; version: number; } {
		let pipe = new SinkBackedObjSource();
		let { completion, newVersion } = this.chainWrite((newVersion: number) => {
			pipe.setObjVersion(newVersion);
			return this.storage.saveObj(this.objId, pipe.getSource());
		});
		let sink = this.crypto.encryptingByteSink(pipe.getSink())
		let originalWrite = sink.write;
		sink.write = async (bytes: Uint8Array|null, err?: any): Promise<void> => {
			if (bytes) {
				await originalWrite(bytes);
			} else {
				originalWrite(null, err);
				await completion;
			}
		}
		if (sink.write === originalWrite) { throw new Error('Cannot wrap write method of a sink object.'); }
		return {
			sink,
			version: newVersion
		}
	}
	
	save(bytes: Uint8Array|Uint8Array[]): Promise<number> {
		return this.saveBytes(bytes).completion;
	}

	getParamsForLink(): LinkParameters<FileLinkParams> {
		if ((this.storage.type !== 'synced') && (this.storage.type !== 'local')) {
			throw new Error(`Creating link parameters to object in ${this.storage.type} file system, is not implemented.`); }
		let params: FileLinkParams = {
			fileName: (undefined as any),
			objId: this.objId,
			fKey: this.crypto.fileKeyInBase64()
		};
		let linkParams: LinkParameters<FileLinkParams> = {
			storageType: this.storage.type,
			isFile: true,
			params
		};
		return linkParams;
	}
	
}
Object.freeze(FileNode.prototype);
Object.freeze(FileNode);

Object.freeze(exports);