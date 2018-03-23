/*
 Copyright (C) 2015 - 2017 3NSoft Inc.
 
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

import { ByteSource, ByteSink }
	from '../../../lib-common/byte-streaming/common';
import { ObjSink, ObjSource } from '../../../lib-common/obj-streaming/common';
import { SinkBackedObjSource } from '../../../lib-common/obj-streaming/pipe';
import { makeDecryptedByteSource, makeEncryptingByteSink, idToHeaderNonce }
	from '../../../lib-common/obj-streaming/crypto';
import { syncWrapByteSink, syncWrapByteSource }
	from '../../../lib-common/byte-streaming/concurrent';
import { NodeInFS, NodeCrypto } from './node-in-fs';
import { LinkParameters } from '../../files';
import { Storage, AsyncSBoxCryptor } from './common';
import { base64 } from '../../../lib-common/buffer-utils';
import { defer } from '../../../lib-common/processes';

class FileCrypto extends NodeCrypto {
	
	constructor(zNonce: Uint8Array, key: Uint8Array, cryptor: AsyncSBoxCryptor) {
		super(zNonce, key, cryptor);
		Object.seal(this);
	}
	
	async decryptedBytesSource(src: ObjSource): Promise<ByteSource> {
		return syncWrapByteSource(await makeDecryptedByteSource(
			src, header => this.segReader(src.version, header)));
	}
	
	async encryptingByteSink(version: number, objSink: ObjSink):
			Promise<ByteSink> {
		const writer = await this.segWriter(version);
		return syncWrapByteSink(makeEncryptingByteSink(objSink, writer));
	}
	
}
Object.freeze(FileCrypto.prototype);
Object.freeze(FileCrypto);

export interface FileLinkParams {
	fileName: string;
	objId: string;
	fKey: string;
}

type FileChangeEvent = web3n.files.FileChangeEvent;

export class FileNode extends NodeInFS<FileCrypto> {

	private constructor(storage: Storage, name: string,
			objId: string, version: number, parentId: string|undefined,
			key: Uint8Array) {
		super(storage, 'file', name, objId, version, parentId);
		if (!name || !objId) { throw new Error("Bad file parameter(s) given"); }
		this.crypto = new FileCrypto(
			idToHeaderNonce(this.objId), key, this.storage.cryptor);
		Object.seal(this);
	}

	static makeForNew(storage: Storage, parentId: string, name: string,
			key: Uint8Array, cryptor: AsyncSBoxCryptor): FileNode {
		if (!parentId) { throw new Error("Bad parent id"); }
		const objId = storage.generateNewObjId();
		return new FileNode(storage, name, objId, 0, parentId, key);
	}

	static async makeForExisting(storage: Storage, parentId: string,
			name: string, objId: string, key: Uint8Array): Promise<FileNode> {
		if (!parentId) { throw new Error("Bad parent id"); }
		const src = await storage.getObj(objId);
		return new FileNode(
			storage, name, objId, src.version, parentId, key);
	}

	static async makeFromLinkParams(storage: Storage, params: FileLinkParams):
			Promise<FileNode> {
		const { objId, fileName } = params;
		const key = base64.open(params.fKey);
		const src = await storage.getObj(objId);
		return new FileNode(storage, fileName,
			objId, src.version, undefined,  key);
	}
	
	async readSrc(): Promise<{ src: ByteSource; version: number; }> {
		const objSrc = await this.storage.getObj(this.objId);
		const src = await this.crypto.decryptedBytesSource(objSrc);
		const isVersioned = (this.storage.type === 'synced') ||
			(this.storage.type === 'local');
		if (!isVersioned) {
			return { src, version: (undefined as any) };
		}
		const version = objSrc.version;
		if (this.version < version) {
			this.setCurrentVersion(version);
		}
		return { src, version };
	}

	async writeSink(): Promise<{ sink: ByteSink; version: number; }> {
		// XXX do we have a proper back-pressure in this pipe arrangement?
		// We should, but this is not obvious here.
		const deferredPipe = defer<SinkBackedObjSource>();
		const completion = this.doChange(false, async () => {
			// XXX is version change rolled back, if sink is never used, and even
			// if it is garbage collected?
			const newVersion = this.version + 1;
			const pipe = new SinkBackedObjSource(newVersion);
			deferredPipe.resolve(pipe);
			await this.storage.saveObj(this.objId, pipe.getSource());
			this.setCurrentVersion(newVersion);
			const event: FileChangeEvent = {
				type: 'file-change',
				path: this.name,
				newVersion
			};
			this.broadcastEvent(event);
		});
		const pipe = await deferredPipe.promise;
		const sink = await this.crypto.encryptingByteSink(
			pipe.version, pipe.getSink());
		const originalWrite = sink.write;
		sink.write = async (bytes: Uint8Array|null, err?: any): Promise<void> => {
			if (bytes) {
				await originalWrite(bytes);
			} else {
				await originalWrite(null, err);
				await completion;
			}
		};
		if (sink.write === originalWrite) { throw new Error('Failed to wrap write method of a sink object (it could be frozen).'); }
		return {
			sink,
			version: pipe.version
		};
	}
	
	save(bytes: Uint8Array|Uint8Array[]): Promise<number> {
		return this.doChange(false, async () => {
			const newVersion = this.version + 1;
			const src = await this.crypto.packBytes(bytes, newVersion);
			await this.storage.saveObj(this.objId, src);
			this.setCurrentVersion(newVersion);
			const event: FileChangeEvent = {
				type: 'file-change',
				path: this.name,
				newVersion
			};
			this.broadcastEvent(event);
			return this.version;
		});
	}

	getParamsForLink(): LinkParameters<FileLinkParams> {
		if ((this.storage.type !== 'synced') && (this.storage.type !== 'local')) {
			throw new Error(`Creating link parameters to object in ${this.storage.type} file system, is not implemented.`); }
		const params: FileLinkParams = {
			fileName: (undefined as any),
			objId: this.objId,
			fKey: this.crypto.fileKeyInBase64()
		};
		const linkParams: LinkParameters<FileLinkParams> = {
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