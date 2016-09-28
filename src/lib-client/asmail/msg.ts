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

import { utf8 } from '../../lib-common/buffer-utils';
import { getKeyCert, SignedLoad, JsonKeyShort } from '../../lib-common/jwkeys';
import { secret_box as sbox } from 'ecma-nacl';
import { SegmentsReader, makeFileKeyHolder, makeNewFileKeyHolder }
	from 'xsp-files';
import * as delivApi from '../../lib-common/service-api/asmail/delivery';
import * as retrievalApi from '../../lib-common/service-api/asmail/retrieval';
import * as keyringMod from './keyring/index';
import * as random from '../random-node';
import * as xspUtil from '../../lib-client/xsp-utils';
import { MailerIdServiceInfo } from '../../lib-client/service-locator';
import { relyingParty as mid } from '../../lib-common/mid-sigs-NaCl-Ed';

export interface EncrDataBytes {
	head: Uint8Array;
	segs: Uint8Array[];
}

function countTotalLength(bytes: EncrDataBytes): number {
	let totalLen = bytes.head.length;
	for (let i=0; i<bytes.segs.length; i+=1) {
		totalLen += bytes.segs[i].length;
	}
	return totalLen;
}

export interface MsgPart<T> {
	data: T;
	encrBytes: EncrDataBytes;
	id: string;
}

export interface MainData {
	[field: string]: any;
}

export interface MetaForEstablishedKeyPair {
	pid: string;
}

export interface MetaForNewKey {
	recipientKid: string;
	senderPKey: string;
}

export interface SuggestedNextKeyPair {
	pids: string[];
	senderKid: string;
	recipientPKey: JsonKeyShort;
	invitation?: string;
}

export interface CryptoCertification {
	keyCert: SignedLoad;
	senderCert: SignedLoad;
	provCert: SignedLoad;
}

export let HEADERS = {
	TO: 'To',
	CC: 'Cc',
	SUBJECT: 'Subject',
	DO_NOT_REPLY: 'Do Not Reply'
};

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

export interface MainBody {
	text?: {
		plain?: string;
		html?: string;
	}
}

let SEG_SIZE_IN_K_QUATS = 16;

function encryptByteArray(plainBytes: Uint8Array,
		mkeyEnc: sbox.Encryptor): EncrDataBytes {
	let keyHolder = makeNewFileKeyHolder(mkeyEnc, random.bytes);
	let w = keyHolder.newSegWriter(SEG_SIZE_IN_K_QUATS, random.bytes);
	w.setContentLength(plainBytes.length);
	let head = w.packHeader();
	let segs: Uint8Array[] = [];
	let offset = 0;
	let segInd = 0;
	let encRes: { dataLen: number; seg: Uint8Array };
	while (offset < plainBytes.length) {
		encRes = w.packSeg(plainBytes.subarray(offset), segInd);
		offset += encRes.dataLen;
		segInd += 1;
		segs.push(encRes.seg);
	}
	let encBytes: EncrDataBytes = {
		head: head,
		segs: segs
	};
	Object.freeze(encBytes.segs);
	Object.freeze(encBytes);
	w.destroy();
	keyHolder.destroy();
	return encBytes;
}

function encryptJSON(json: any, mkeyEnc: sbox.Encryptor):
		EncrDataBytes {
	let plainBytes = utf8.pack(JSON.stringify(json));
	return encryptByteArray(plainBytes, mkeyEnc);
}

export interface SendReadyForm {
	meta: delivApi.msgMeta.Request;
	bytes: {
		[id: string]: EncrDataBytes;
	};
	totalLen: number;
}

export class MsgPacker {
	
	meta: MetaForEstablishedKeyPair | MetaForNewKey;
	main: MsgPart<MainData>;
	private allObjs: { [id: string]: MsgPart<any>; };
	
	constructor() {
		this.meta = null;
		this.allObjs = {};
		this.main = this.addMsgPart(<MainData> {});
		Object.seal(this);
	}

	private addMsgPart<T>(data: T): MsgPart<T> {
		let id: string;
		do {
			id = random.stringOfB64UrlSafeChars(4);
		} while (this.allObjs[id]);
		let p: MsgPart<T> = {
			data: data,
			id: id,
			encrBytes: null
		};
		Object.seal(p);
		this.allObjs[id] = p;
		return p;
	}

	/**
	 * This sets a plain text body.
	 * @param text
	 */
	setPlainTextBody(text: string): void {
		this.main.data[MANAGED_FIELDS.BODY] = {
			text: { plain: text }
		};
	}

	/**
	 * This sets a plain html body.
	 * @param html
	 */
	setHtmlTextBody(html: string): void {
		this.main.data[MANAGED_FIELDS.BODY] = {
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
		if (isManagedField(name)) { throw new Error(
			"Cannot directly set message field '"+name+"'."); }
		if (value === undefined) { return; }
		this.main.data[name] = JSON.parse(JSON.stringify(value));
	}
	
	setMetaForEstablishedKeyPair(pid: string): void {
		if (this.meta) { throw new Error(
			"Message metadata has already been set."); }
		this.meta = <MetaForEstablishedKeyPair> {
			pid: pid,
		};
		Object.freeze(this.meta);
	}
	
	setMetaForNewKey(recipientKid: string, senderPKey: string,
			keyCert: SignedLoad, senderCert: SignedLoad,
			provCert: SignedLoad): void {
		if (this.meta) { throw new Error(
			"Message metadata has already been set."); }
		this.meta = <MetaForNewKey> {
			recipientKid: recipientKid,
			senderPKey: senderPKey,
		};
		Object.freeze(this.meta);
		this.main.data[MANAGED_FIELDS.CRYPTO_CERTIF] = <CryptoCertification> {
			keyCert: keyCert,
			senderCert: senderCert,
			provCert: provCert
		};
	}
	
	setNextKeyPair(pair: SuggestedNextKeyPair): void {
		if (this.main.data[MANAGED_FIELDS.NEXT_CRYPTO]) { throw new Error(
			"Next Crypto has already been set in the message."); }
		this.main.data[MANAGED_FIELDS.NEXT_CRYPTO] = pair;
	}

	private toSendForm(): SendReadyForm {
		if (!this.meta) { throw new Error("Metadata has not been set."); }
		let meta: delivApi.msgMeta.Request =
			JSON.parse(JSON.stringify(this.meta));
		meta.objIds = [ this.main.id ];
		let bytes: { [id: string]: EncrDataBytes; } = {};
		let totalLen = 0;
		for (let id of Object.keys(this.allObjs)) {
			let msgPart = this.allObjs[id];
			if (!msgPart.encrBytes) { throw new Error(
				"Message object "+id+"is not encrypted."); }
			bytes[id] = msgPart.encrBytes;
			totalLen += countTotalLength(msgPart.encrBytes);
			if (id !== this.main.id) {
				meta.objIds.push(id);
			}
		}
		return {
			meta: meta,
			bytes: bytes,
			totalLen: totalLen
		};
	}
	
	private throwupOnMissingParts() {
		if (!this.meta) { throw new Error("Message meta is not set"); }
		if (!this.main.data[HEADERS.DO_NOT_REPLY] &&
				!this.main.data[MANAGED_FIELDS.NEXT_CRYPTO]) { throw new Error(
			"Next Crypto is not set."); }
		if (!this.main.data[MANAGED_FIELDS.BODY]) { throw new Error(
			"Message Body is not set."); }
		if ((<MetaForNewKey> this.meta).senderPKey &&
				!this.main.data[MANAGED_FIELDS.CRYPTO_CERTIF]) { throw new Error(
			"Sender's key certification is missing."); }
	}
	
	encrypt(mkeyEnc: sbox.Encryptor): SendReadyForm {
		this.throwupOnMissingParts();
		if (Object.keys(this.allObjs).length > 1) { throw new Error(
			"This test implementation is not encrypting multi-part messages"); }
		this.main.encrBytes = encryptJSON(this.main.data, mkeyEnc);
		return this.toSendForm();
	}
	
}
Object.freeze(MsgPacker.prototype);
Object.freeze(MsgPacker);

export class MsgOpener {
	
	totalSize = 0;
	
	private senderAddress: string = null;
	private senderKeyInfo: string = null;
	get sender(): { address: string; usedKeyInfo: string; } {
		if (!this.senderKeyInfo) { throw new Error("Sender is not set."); }
		return {
			address: this.senderAddress,
			usedKeyInfo: this.senderKeyInfo
		};
	}
	
	private mainObjReader: SegmentsReader = null;
	private mainDatum: MainData;
	get main(): MainData {
		return this.mainDatum;
	}
	
	constructor(
			public msgId: string,
			public meta: retrievalApi.MsgMeta) {
		this.totalSize = 0;
		if (this.meta.extMeta.objIds.length === 0) {
			throw new Error("There are no obj ids.");
		}
		this.meta.extMeta.objIds.forEach((objId) => {
			let objSize = this.meta.objSizes[objId];
			if (!objSize) { return; }
			this.totalSize += objSize.header;
			this.totalSize += objSize.segments;
		});
	}
	
	/**
	 * This method tries to setup crypto mechanisms of this message.
	 * It involves decrypting of main object's header with a proposed decryptor.
	 * If decryptor cannot open header, an exception is thrown, and no changes
	 * are done to this opener, allowing to try different possible decryptors.
	 * @param decrInfo a possible decryptor of this message
	 * @param mainHeader is a complete header of the message's main object 
	 */
	setCrypto(decrInfo: keyringMod.DecryptorWithInfo, mainHeader: Uint8Array):
			void {
		let kh = makeFileKeyHolder(decrInfo.decryptor, mainHeader);
		this.mainObjReader = kh.segReader(mainHeader);
		this.senderKeyInfo = decrInfo.cryptoStatus;
		if (decrInfo.correspondent) {
			this.senderAddress = decrInfo.correspondent;
		}
	}
	
	isCryptoSet(): boolean {
		return !!this.mainObjReader;
	}
	
	/**
	 * This function sets up main object.
	 * When sender is not known, its identity is obtained via verification of
	 * provided MailerId certificates inside of the main object.
	 * An error is thrown, when such verification fails.
	 * @param mainObjSegs is a single byte array with all segments of message's
	 * main object
	 * @param midRootCert is a function that gets MailerId root certificate for
	 * a given address. This parameter must be given, when sender's identity
	 * is not known, and should be established via openning main object, and
	 * checking sender's MailerId signature certification of its public key.
	 */
	async setMain(mainObjSegs: Uint8Array,
			midRootCert?: (address: string) => Promise<
				{ info: MailerIdServiceInfo; domain: string; }>):
			Promise<void> {
		if (this.mainDatum) { throw new Error("Main has already been set."); }
		if (!this.mainObjReader) { throw new Error("Crypto is not set"); }
		let bytes = xspUtil.openAllSegs(this.mainObjReader, mainObjSegs);
		let main: MainData = JSON.parse(utf8.open(bytes));
		if (this.senderAddress) {
			this.mainDatum = main;
			return;
		}
		if ('function' !== typeof midRootCert) { throw new Error(
			"Certificate verifier is not given, when it is needed for "+
			"verification of sender's introductory key, and sender's "+
			"identity."); }
		if (!this.meta.extMeta.senderPKey) { throw new Error(
			"Sender key is missing in external meta, while message's "+
			"sender is not known, which is possible only when sender "+
			"key is given in external meta."); }
		let currentCryptoCert = <CryptoCertification>
			main[MANAGED_FIELDS.CRYPTO_CERTIF];
		let senderPKeyCert = getKeyCert(currentCryptoCert.keyCert);
		if (senderPKeyCert.cert.publicKey.k !==
				this.meta.extMeta.senderPKey) {
			this.mainObjReader = null;
			throw new Error("Sender's key used for encryption "+
				"is not the same as the one, provided with certificates "+
				"in the message.");
		}
		let senderAddress = senderPKeyCert.cert.principal.address;
		if (this.meta.authSender && (this.meta.authSender !== senderAddress)) {
			throw new Error("Sender address, used in authentication to "+
				"server, is not the same as the one used for athentication "+
				"of an introductory key");
		}
		let midServ = await midRootCert(senderAddress);
		let validAt = Math.round(this.meta.deliveryCompletion/1000);
		mid.verifyPubKey(
			currentCryptoCert.keyCert, senderAddress,
			{ user: currentCryptoCert.senderCert,
				prov: currentCryptoCert.provCert,
				root: midServ.info.currentCert },
			midServ.domain, validAt);
		this.senderAddress = senderAddress;
		this.mainDatum = main;
	}
	
	getMainBody(): MainBody {
		if (!this.main) { throw new Error("Main message part is not set."); }
		let body = this.main[MANAGED_FIELDS.BODY];
		if (!body) { throw new Error("Body is missing in the main part."); }
		return body;
	}
	
	getNextCrypto(): SuggestedNextKeyPair {
		if (!this.main) { throw new Error("Main message part is not set."); }
		return this.main[MANAGED_FIELDS.NEXT_CRYPTO];
	}
	
	getHeader(name: string): any {
		if (!this.main) { throw new Error("Main message part is not set."); }
		return this.main[HEADERS.SUBJECT];
	}
	
}
Object.freeze(MsgOpener.prototype);
Object.freeze(MsgOpener);

Object.freeze(exports);