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

import { getKeyCert, SignedLoad, JsonKeyShort } from '../../lib-common/jwkeys';
import { secret_box as sbox, arrays } from 'ecma-nacl';
import { SegmentsReader, makeNewFileKeyHolder, SegmentsWriter, FileKeyHolder }
	from 'xsp-files';
import * as delivApi from '../../lib-common/service-api/asmail/delivery';
import * as retrievalApi from '../../lib-common/service-api/asmail/retrieval';
import * as random from '../random-node';
import { base64, base64urlSafe, utf8 } from '../../lib-common/buffer-utils';
import { MailerIdServiceInfo } from '../service-locator';
import { relyingParty as mid } from '../../lib-common/mid-sigs-NaCl-Ed';
import { FolderJson, FS, File } from '../3nstorage/xsp-fs/common';
import { ObjSource } from '../../lib-common/obj-streaming/common';
import { bind } from '../../lib-common/binding';
import { makeObjByteSourceFromArrays, makeObjByteSourceFromByteSource,
	makeDecryptedByteSource } from '../../lib-common/obj-streaming/crypto';
import { errWithCause } from '../../lib-common/exceptions/error';
import * as confApi from '../../lib-common/service-api/asmail/config';

type AttachmentsContainer = web3n.asmail.AttachmentsContainer;

/**
 * Metadata for message that uses established key pair. 
 * It is an unencrypted part of a message.
 */
export interface MetaForEstablishedKeyPair {
	pid: string;
}

/**
 * Metadata for message that uses introductory keys.
 * It is an unencrypted part of a message.
 */
export interface MetaForNewKey {
	recipientKid: string;
	senderPKey: string;
}

/**
 * Main (zeroth) object json.
 * It is an encrypted part of a message.
 */
export interface MainData {
	[field: string]: any;
}

/**
 * Object with suggested next crypto.
 * Located in main object.
 */
export interface SuggestedNextKeyPair {
	pids: string[];
	senderKid: string;
	recipientPKey: JsonKeyShort;
	invitation?: string;
}

/**
 * Common fields in main object.
 */
export let HEADERS = {
	FROM: 'From',
	TO: 'To',
	CC: 'Cc',
	SUBJECT: 'Subject',
	DO_NOT_REPLY: 'Do Not Reply'
};

/**
 * Common fields in a main object, managed by api a little closer.
 */
let MANAGED_FIELDS = {
	BODY: 'Body',
	NEXT_CRYPTO: 'Next Crypto',
	CRYPTO_CERTIF: 'Crypto Certification',
	ATTACHMENTS: 'Attachments'
};
let isManagedField = (() => {
	let fieldsInLowCase: string[] = [];
	for (let fName of Object.keys(MANAGED_FIELDS)) {
		fieldsInLowCase.push(MANAGED_FIELDS[fName].toLowerCase());
	}
	return (name: string) => {
		return (fieldsInLowCase.indexOf(name.toLowerCase()) > -1);
	};
})();

/**
 * This object is for attachments and linking other objects in main object.
 * This is folder json with a master key for encryption of all child nodes.
 */
export interface FolderJsonWithMKey {
	/**
	 * mkey is a master key for all nodes in this folder
	 */
	mkey: string;
	/**
	 * folder is a folder json structure, exactly the same as one used in storage
	 */
	folder: FolderJson
}

/**
 * 
 */
export interface MainBody {
	text?: {
		plain?: string;
		html?: string;
	}
}

export interface SendReadyForm {
	meta: delivApi.msgMeta.Request;
	objSrc(objId: string): Promise<ObjSource>;
	totalLen: number;
}

interface MsgObj {
	json?: any;
	folder?: FolderJsonWithMKey;
	file?: File;
	src?: ObjSource;
	/**
	 * mkey is either a master key for this object, or a master key encryptor 
	 */
	mkey?: string;
	/**
	 * This is object's id in the message
	 */
	id: string;
}

const SEG_SIZE_IN_K_QUATS = 16;

export class MsgPacker {

	private meta: MetaForEstablishedKeyPair | MetaForNewKey = (undefined as any);
	private main: MainData;
	private mainObjId: string;
	private allObjs = new Map<string, MsgObj>();
	private readyPack: SendReadyForm|undefined = undefined;
	private hasAttachments = false;
	
	constructor() {
		this.main = ({} as MainData);
		this.mainObjId = this.addJsonObj(this.main);
		Object.seal(this);
	}

	private generateObjId(): string {
		let id: string;
		do {
			id = base64urlSafe.pack(random.bytes(sbox.NONCE_LENGTH));
		} while (this.allObjs.has(id));
		return id;
	}

	private addJsonObj(json: any): string {
		let id = this.generateObjId();
		this.allObjs.set(id, { id, json });
		return id;
	}

	private addFileInto(fJSON: FolderJson, fName: string, file: File,
			mkey: string): void {
		let id = this.generateObjId();
		this.allObjs.set(id, { id, file, mkey });
		fJSON.nodes[fName] = {
			objId: id,
			name: fName,
			isFile: true
		};
	}

	/**
	 * @return a promise, resolvable to content size, which is predictably less,
	 * than packed size.
	 */
	async sizeBeforePacking(): Promise<number> {
		let totalSize = 0;
		for (let o of this.allObjs.values()) {
			if (o.file) {
				totalSize += (await o.file.stat()).size;
			} else if (o.folder) {
				totalSize += utf8.pack(JSON.stringify(o.folder)).length;
			} else if (o.json) {
				totalSize += utf8.pack(JSON.stringify(o.json)).length;
			}
		}
		return totalSize;
	}

	private async addFolderInto(outerFolder: FolderJson, fName: string,
			fs: FS, outerMKey: string): Promise<void> {
		
		// prepare folder object with new master key
		let mkey = base64.pack(random.bytes(sbox.KEY_LENGTH));
		let folder: FolderJsonWithMKey = { mkey, folder: { nodes: {} } };
		let fJSON = folder.folder;
		for (let entry of await fs.listFolder('.')) {
			let fName = entry.name;
			if (entry.isFile) {
				let f = await fs.readonlyFile(fName);
				this.addFileInto(fJSON, fName, f, mkey);
			} else if (entry.isFolder) {
				let f = await fs.readonlySubRoot(fName);
				this.addFolderInto(fJSON, fName, f, mkey);
			}
			// note that links are ignored.
		}

		// attach folder to the rest of the message
		let id = this.generateObjId();
		this.allObjs.set(id, { id, mkey: outerMKey, folder });
		outerFolder.nodes[fName] = {
			objId: id,
			name: fName,
			isFolder: true
		};
	}

	private throwIfAlreadyPacked(): void {
		if (this.readyPack) { throw new Error(`Message is already packed.`); }
	}

	/**
	 * This sets a plain text body.
	 * @param text
	 */
	setPlainTextBody(text: string): void {
		this.throwIfAlreadyPacked();
		this.main[MANAGED_FIELDS.BODY] = {
			text: { plain: text }
		};
	}

	/**
	 * This sets a plain html body.
	 * @param html
	 */
	setHtmlTextBody(html: string): void {
		this.throwIfAlreadyPacked();
		this.main[MANAGED_FIELDS.BODY] = {
			text: { html: html }
		};
	}

	/**
	 * This sets named header to a given value.
	 * These headers go into main object, which is encrypted.
	 * @param name
	 * @param value can be string, number, or json.
	 */
	setHeader(name: string, value: any): void {
		this.throwIfAlreadyPacked();
		if (isManagedField(name)) { throw new Error(
			"Cannot directly set message field '"+name+"'."); }
		if (value === undefined) { return; }
		this.main[name] = JSON.parse(JSON.stringify(value));
	}
	
	setMetaForEstablishedKeyPair(pid: string): void {
		this.throwIfAlreadyPacked();
		if (this.meta) { throw new Error(
			"Message metadata has already been set."); }
		this.meta = <MetaForEstablishedKeyPair> {
			pid: pid,
		};
		Object.freeze(this.meta);
	}
	
	setMetaForNewKey(recipientKid: string, senderPKey: string,
			pkeyCerts: confApi.p.initPubKey.Certs): void {
		this.throwIfAlreadyPacked();
		if (this.meta) { throw new Error(
			"Message metadata has already been set."); }
		this.meta = <MetaForNewKey> {
			recipientKid: recipientKid,
			senderPKey: senderPKey,
		};
		Object.freeze(this.meta);
		this.main[MANAGED_FIELDS.CRYPTO_CERTIF] = pkeyCerts;
	}
	
	setNextKeyPair(pair: SuggestedNextKeyPair): void {
		this.throwIfAlreadyPacked();
		this.main[MANAGED_FIELDS.NEXT_CRYPTO] = pair;
	}

	async setAttachments(container?: AttachmentsContainer, fs?: FS):
			Promise<void> {
		this.throwIfAlreadyPacked();
		if (this.hasAttachments) { throw new Error(
			`Attachments are already set.`); }

		// master key for attachments
		let mkey = base64.pack(random.bytes(sbox.KEY_LENGTH));

		// attachments "folder" and l-funcs for adding files and folders
		let attachments: FolderJsonWithMKey = { mkey, folder: { nodes: {} } };
		let fJSON = attachments.folder;

		// populate attachments json
		let attachmentsEmpty = true;
		if (container &&
				((container.getAllFiles().size > 0) ||
				(container.getAllFolders().size > 0))) {
			for (let entry of container.getAllFiles()) {
				this.addFileInto(fJSON, entry[0], entry[1], mkey);
			}
			for (let entry of container.getAllFolders()) {
				await this.addFolderInto(fJSON, entry[0], entry[1], mkey);
			}
			attachmentsEmpty = false;
		} else if (fs) {
			for (let entry of await fs.listFolder('.')) {
				let fName = entry.name;
				if (entry.isFile) {
					let f = await fs.readonlyFile(fName);
					this.addFileInto(fJSON, fName, f, mkey);
				} else if (entry.isFolder) {
					let f = await fs.readonlySubRoot(fName);
					await this.addFolderInto(fJSON, fName, f, mkey);
				} else {
					// note that links are ignored.
					continue;
				}
				attachmentsEmpty = false;
			}
		} else {
			throw new Error(`Given neither container with attachments, nor attachments' file system.`);
		}

		// insert attachments json into main object
		if (!attachmentsEmpty) {
			this.main[MANAGED_FIELDS.ATTACHMENTS] = attachments;
			this.hasAttachments = true;
		}
	}
	
	private throwupOnMissingParts() {
		if (!this.meta) { throw new Error("Message meta is not set"); }
		if (!this.main[HEADERS.DO_NOT_REPLY] &&
				!this.main[MANAGED_FIELDS.NEXT_CRYPTO]) { throw new Error(
			"Next Crypto is not set."); }
		if (!this.main[MANAGED_FIELDS.BODY]) { throw new Error(
			"Message Body is not set."); }
		if ((<MetaForNewKey> this.meta).senderPKey &&
				!this.main[MANAGED_FIELDS.CRYPTO_CERTIF]) { throw new Error(
			"Sender's key certification is missing."); }
	}

	private async getObjSrc(objId: string, mainObjEnc?: sbox.Encryptor):
			Promise<ObjSource> {
		let obj = this.allObjs.get(objId);
		if (!obj) { throw new Error(
			`Object ${objId} is not found in the message`); }
		if (obj.src) { return obj.src; }

		// make object segments writer
		let segWriter: SegmentsWriter;
		let arrFactory = arrays.makeFactory();
		if (objId === this.mainObjId) {
			if (!mainObjEnc) { throw new Error(
				`Encryptor for main object is not given`); }
			let kh = makeNewFileKeyHolder(mainObjEnc, random.bytes, arrFactory);
			segWriter = kh.newSegWriter(SEG_SIZE_IN_K_QUATS, random.bytes);
		} else if (!obj.mkey) {
			throw new Error(`Object ${objId} has no associated key`);
		} else {
			let key = base64.open(obj.mkey);
			let nonce = base64urlSafe.open(objId);
			let mkeyEnc = sbox.formatWN.makeEncryptor(key, nonce);
			let kh = makeNewFileKeyHolder(mkeyEnc, random.bytes, arrFactory);
			segWriter = kh.newSegWriter(SEG_SIZE_IN_K_QUATS, random.bytes);
		}

		// make object source
		let src: ObjSource;
		if (obj.json) {
			let bytes = utf8.pack(JSON.stringify(obj.json));
			src = makeObjByteSourceFromArrays(bytes, segWriter);
		} else if (obj.file) {
			let byteSrc = await obj.file.getByteSource();
			src = makeObjByteSourceFromByteSource(byteSrc, segWriter);
		} else if (obj.folder) {
			let mkeyBytes = base64urlSafe.open(obj.folder.mkey);
			let jsonBytes = utf8.pack(JSON.stringify(obj.folder.folder));
			src = makeObjByteSourceFromArrays(
				[ mkeyBytes, jsonBytes ], segWriter);
		} else {
			throw new Error(`Object ${objId} is broken`);
		}
		obj.src = src;
		return src;
	}
	
	async pack(mkeyEnc: sbox.Encryptor): Promise<SendReadyForm> {
		if (this.readyPack) { return this.readyPack; }
		if (!this.meta) { throw new Error("Metadata has not been set."); }
		let meta: delivApi.msgMeta.Request =
			JSON.parse(JSON.stringify(this.meta));
		meta.objIds = [ this.mainObjId ];
		let totalLen = 0;
		for (let objId of this.allObjs.keys()) {
			let src: ObjSource;
			if (objId === this.mainObjId) {
				src = await this.getObjSrc(objId, mkeyEnc);
			} else {
				meta.objIds.push(objId);
				src = await this.getObjSrc(objId);
			}
			totalLen += await src.segSrc.getSize();
			totalLen += (await src.readHeader()).length;
		}
		this.readyPack = { meta, totalLen, objSrc: bind(this, this.getObjSrc) };
		return this.readyPack;
	}
	
}
Object.freeze(MsgPacker.prototype);
Object.freeze(MsgPacker);

export class OpenedMsg {
	
	constructor(
			public msgId: string,
			private main: MainData) {
		Object.freeze(this);
	}
	
	getHeader(name: string): any {
		return this.main[name];
	}

	getSender(): string {
		return this.getHeader(HEADERS.FROM);
	}
	
	getMainBody(): MainBody {
		let body: MainBody = this.getHeader(MANAGED_FIELDS.BODY);
		return (body ? body : {});
	}
	
	getNextCrypto(): SuggestedNextKeyPair|undefined {
		return this.getHeader(MANAGED_FIELDS.NEXT_CRYPTO);
	}

	getCurrentCryptoCerts(): confApi.p.initPubKey.Certs {
		return this.getHeader(MANAGED_FIELDS.CRYPTO_CERTIF);
	}

	getAttachmentsJSON(): FolderJsonWithMKey|undefined {
		return this.getHeader(MANAGED_FIELDS.ATTACHMENTS);
	}
	
}
Object.freeze(OpenedMsg.prototype);
Object.freeze(OpenedMsg);


export async function openMsg(msgId: string, mainObj: ObjSource,
		fKeyHolder: FileKeyHolder): Promise<OpenedMsg> {
	try {
		let byteSrc = await makeDecryptedByteSource(
			mainObj, fKeyHolder.segReader);
		let bytes = await byteSrc.read(undefined);
		if (!bytes) { throw new Error(`End of bytes is reached too soon`); }
		let jsonOfMain = JSON.parse(utf8.open(bytes));
		return new OpenedMsg(msgId, jsonOfMain);
	} catch (err) {
		throw errWithCause(err, `Cannot open main object of message ${msgId}`);
	}
}

Object.freeze(exports);