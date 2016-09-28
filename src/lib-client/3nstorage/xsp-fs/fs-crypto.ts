/*
 Copyright (C) 2015 3NSoft Inc.
 
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
import { utf8 } from '../../../lib-common/buffer-utils';
import { FolderJson } from './fs-entities';
import { ByteSink, ByteSource }
	from '../../../lib-common/byte-streaming/common';
import { ObjSink }
	from '../../../lib-common/obj-streaming/common';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { makeDecryptedByteSource, makeEncryptingByteSink,
	makeObjByteSourceFromArrays }
	from '../../../lib-common/obj-streaming/crypto';
import { syncWrapByteSink, syncWrapByteSource }
	from '../../../lib-common/byte-streaming/concurrent';


const SEG_SIZE = 16;	// in 256-byte blocks

export abstract class EntityCrypto {
	
	constructor(
			protected keyHolder: FileKeyHolder) {
	}
	
	wipe(): void {
		if (this.keyHolder) {
			this.keyHolder.destroy();
			this.keyHolder = null;
		}
	}

	reencryptTo(fKeyEncr: sbox.Encryptor, header: Uint8Array): Uint8Array {
		return this.keyHolder.reencryptKey(fKeyEncr, header);
	}
}

export class FileCrypto extends EntityCrypto {
	
	constructor(keyHolder: FileKeyHolder) {
		super(keyHolder);
		Object.seal(this);
	}
	
	wipe(): void {
		if (this.keyHolder) {
			this.keyHolder.destroy();
			this.keyHolder = null;
		}
	}
	
	static makeForNewFile(parentEnc: sbox.Encryptor,
			arrFactory: arrays.Factory): FileCrypto {
		let keyHolder = makeNewFileKeyHolder(parentEnc, random.bytes, arrFactory);
		parentEnc.destroy();
		let fc = new FileCrypto(keyHolder);
		return fc;
	}
	
	/**
	 * @param parentDecr
	 * @param src for the whole xsp object
	 * @param arrFactory
	 * @return folder crypto object with null mkey, which should be set
	 * somewhere else.
	 */
	static async makeForExistingFile(parentDecr: sbox.Decryptor,
			header: Uint8Array, arrFactory: arrays.Factory): Promise<FileCrypto> {
		let keyHolder = makeFileKeyHolder(parentDecr, header, arrFactory);
		parentDecr.destroy();
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
	
	pack(bytes: Uint8Array|Uint8Array[], version: number): ObjSource {
		if (!this.keyHolder) { throw new Error("Cannot use wiped object."); }
		let segWriter = this.keyHolder.newSegWriter(SEG_SIZE, random.bytes);
		let objSrc = makeObjByteSourceFromArrays(bytes, segWriter, version);
		segWriter.destroy();
		return objSrc;
	}
	
}
Object.freeze(FileCrypto.prototype);
Object.freeze(FileCrypto);

export class FolderCrypto extends EntityCrypto {
	
	private mkey: Uint8Array = null;
	private arrFactory = arrays.makeFactory();
	
	constructor(keyHolder: FileKeyHolder) {
		super(keyHolder);
		Object.seal(this);
	}
	
	static makeForNewFolder(
			parentEnc: sbox.Encryptor,
			arrFactory: arrays.Factory): FolderCrypto {
		let keyHolder = makeNewFileKeyHolder(
			parentEnc, random.bytes, arrFactory);
		parentEnc.destroy();
		let fc = new FolderCrypto(keyHolder);
		fc.mkey = random.bytes(sbox.KEY_LENGTH);
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
			objSrc: ObjSource, arrFactory: arrays.Factory):
			Promise<{ crypto: FolderCrypto; folderJson: FolderJson; }> {
		let keyHolder: FileKeyHolder;
		let byteSrc = await makeDecryptedByteSource(objSrc,
			(header: Uint8Array) => {
				keyHolder = makeFileKeyHolder(
					parentDecr, header, arrFactory);
				parentDecr.destroy();
				return keyHolder.segReader(header);
			});
		let bytes = await byteSrc.read(null);
		let fc = new FolderCrypto(keyHolder);
		let folderJson = fc.setMKeyAndParseRestOfBytes(bytes)
		return { crypto: fc, folderJson: folderJson };
	}
	
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
		return sbox.formatWN.makeDecryptor(
			this.mkey, this.arrFactory);
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
		let bytes = await byteSrc.read(null)
		return this.setMKeyAndParseRestOfBytes(bytes);
	}
	
	wipe(): void {
		if (this.keyHolder) {
			this.keyHolder.destroy();
			this.keyHolder = null;
		}
		if (this.mkey) {
			arrays.wipe(this.mkey);
			this.mkey = null;
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

Object.freeze(exports);