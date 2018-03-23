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
 * This file defines a ring, which must be wrapped, when it is exposed
 * outside of keyring's reliance set.
 */

import { IntroKeysContainer } from './intro-keys';
import { CorrespondentKeys, SendingPair } from './correspondent-keys';
import { IdToEmailMap } from './id-to-email-map';
import { extractSKeyBytes, extractKeyBytes, ASMailKeyPair, MsgKeyRole,
	msgKeyPackSizeFor }
	from './common';
import { box, secret_box as sbox, arrays } from 'ecma-nacl';
import { JsonKey, JsonKeyShort, keyToJson, SignedLoad }
	from '../../../lib-common/jwkeys';
import { user as mid } from '../../../lib-common/mid-sigs-NaCl-Ed';
import { SuggestedNextKeyPair, OpenedMsg } from '../msg/opener';
import * as delivApi from '../../../lib-common/service-api/asmail/delivery';
import * as confApi from '../../../lib-common/service-api/asmail/config';
import { KeyRing } from './index';
import * as random from '../../../lib-common/random-node';
import { bind } from '../../../lib-common/binding';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { base64 } from '../../../lib-common/buffer-utils';
import { areAddressesEqual, toCanonicalAddress }
	from '../../../lib-common/canonical-address';

type EncryptionException = web3n.EncryptionException;

export interface MsgKeyInfo {
	correspondent: string;
	key?: string;
	keyStatus: MsgKeyRole;
	msgKeyPackLen: number;
}

export interface Storage {
	load(): Promise<string|undefined>;
	save(serialForm: string): void;
	start(): Promise<void>;
	close(): Promise<void>;
}

function selectPid(pids: string[]): string {
	if (pids.length < 1) { throw new Error("There are no pair ids in array."); }
	const i = Math.round((pids.length-1) * random.uint8Sync()/255);
	return pids[i];
}

interface RingJSON {
	corrKeys: string[];
	introKeys: string;
}

export class Ring implements KeyRing {
	
	introKeys: IntroKeysContainer = (undefined as any);
	
	/**
	 * This is a map from correspondents' canonical addresses to key objects.
	 */
	corrKeys = new Map<string, CorrespondentKeys>();

	introKeyIdToEmailMap = new IdToEmailMap();
	pairIdToEmailMap = new IdToEmailMap();

	private storage: Storage = (undefined as any);
	
	constructor() {
		Object.seal(this);
	}
	
	private addCorrespondent(address: string|undefined, serialForm?: string):
			CorrespondentKeys {
		const ck = (serialForm ?
			new CorrespondentKeys(this, undefined, serialForm) :
			new CorrespondentKeys(this, address));
		if (this.corrKeys.has(ck.correspondent)) { throw new Error(
			"Correspondent with address "+ck.correspondent+
			" is already present."); }
		this.corrKeys.set(ck.correspondent, ck);
		if (serialForm) {
			ck.mapAllKeysIntoRing();
		}
		return ck;
	}
	
	async init(storage: Storage): Promise<void> {
		if (this.storage) { throw new Error(
			"Keyring has already been initialized."); }
		this.storage = storage;
		await this.storage.start();
		const serialForm = await this.storage.load();
		if (serialForm) {
			const json: RingJSON = JSON.parse(serialForm);
			// TODO check json's fields
			
			// init data
			this.introKeys = new IntroKeysContainer(
				this, json.introKeys);
			json.corrKeys.forEach((info) => {
				this.addCorrespondent(undefined, info);
			});
		} else {
			this.introKeys = new IntroKeysContainer(this);
			// save initial file, as there was none initially
			this.saveChanges();
		}
	}

	saveChanges(): void {
		// pack bytes that need to be encrypted and saved
		const dataToSave = <RingJSON> {
			introKeys: this.introKeys.serialForm(),
			corrKeys: []
		};
		for (const corrKeys of this.corrKeys.values()) {
			dataToSave.corrKeys.push(corrKeys.serialForm());
		}
		// trigger saving utility
		this.storage.save(JSON.stringify(dataToSave));
	}
	
	updatePublishedKey(signer: mid.MailerIdSigner): void {
		this.introKeys.updatePublishedKey(signer);
		this.saveChanges();
	}
	
	getPublishedKeyCerts(): confApi.p.initPubKey.Certs|undefined {
		if (this.introKeys.publishedKeyCerts) {
			return this.introKeys.publishedKeyCerts;
		}
		return;	// undefined
	}

	isKnownCorrespondent(address: string): boolean {
		address = toCanonicalAddress(address);
		return this.corrKeys.has(address);
	}
	
	setCorrepondentTrustedIntroKey(address: string, pkey: JsonKey,
			invite: string|null = null): void {
		address = toCanonicalAddress(address);
		let ck = this.corrKeys.get(address);
		if (!ck) {
			ck = this.addCorrespondent(address);
		}
		ck.setIntroKey(pkey, invite!);
		this.saveChanges();
	}
	
	getInviteForSendingTo(correspondent: string): string|undefined {
		correspondent = toCanonicalAddress(correspondent);
		const ck = this.corrKeys.get(correspondent);
		return ((ck && ck.invite) ? ck.invite : undefined);
	}
	
	markPairAsInUse(correspondent: string, pid: string): void {
		const ck = this.corrKeys.get(correspondent);
		if (!ck) { throw new Error(
			`No correspondent keys for ${correspondent}`); }
		ck.markPairAsInUse(pid);
		this.saveChanges();
	}
	
	generateKeysForSendingTo(address: string, invitation?: string,
			introPKeyFromServer?: JsonKey): {
				encryptor: sbox.Encryptor;
				pairs: { current: ASMailKeyPair; next: SuggestedNextKeyPair; }; } {
		address = toCanonicalAddress(address);
		// get, or generate sending pair
		let ck = this.corrKeys.get(address);
		let sendingPair: SendingPair;
		if (ck) {
			sendingPair = ck.getSendingPair();
		} else if (introPKeyFromServer) {
			ck = this.addCorrespondent(address);
			sendingPair = ck.getSendingPair(introPKeyFromServer);
		} else {
			throw new Error("There are no known keys for given address "+
				address+" and a key from a mail server is not given either.");
		}

		// prepare message encryptor
		const mmKey = base64.open(sendingPair.msgMasterKey);
		const nextNonce = random.bytesSync(sbox.NONCE_LENGTH);
		const encryptor = sbox.formatWN.makeEncryptor(mmKey, nextNonce);
		arrays.wipe(mmKey);

		// prepare suggested pair (will be part of encrypted main object)
		const suggestPair = ck.suggestPair(invitation);

		// prepare current crypto info (will be sent in plain text)
		let currentPair: ASMailKeyPair;
		if (sendingPair.isSelfGenerated) {
			currentPair = {
				senderPKey: sendingPair.senderKey.pkey,
				recipientKid: sendingPair.recipientPKey.kid
			};
		} else {
			currentPair = { pid: selectPid(sendingPair.pids) };
		}

		return {
			encryptor: encryptor,
			pairs: { current: currentPair, next: suggestPair }
		};
	}

	private async getDecrytorForIntro(recipientKid: string, senderPKey: string,
			getMainObjHeader: () => Promise<Uint8Array>):
			Promise<MsgKeyInfo|undefined> {
		const recipKey = this.introKeys.findKey(recipientKid!);
		if (!recipKey) { return; }

		const skey = extractSKeyBytes(recipKey.pair.skey);
		const pkey = extractKeyBytes({ kid: '', k: senderPKey! });
		const masterDecr = box.formatWN.makeDecryptor(pkey, skey);
		arrays.wipe(skey, pkey);

		const h = await getMainObjHeader();
		const msgKeyPackLen = msgKeyPackSizeFor(recipKey.pair.skey.alg);
		if (h.length < msgKeyPackLen) { return; }
		try {
			const mainObjFileKey = masterDecr.open(h.subarray(0, 72));
			const info: MsgKeyInfo = {
				correspondent: (undefined as any),
				keyStatus: recipKey.role,
				key: base64.pack(mainObjFileKey),
				msgKeyPackLen
			};
			arrays.wipe(mainObjFileKey);
			return info;
		} catch (err) {
			if (!(err as EncryptionException).failedCipherVerification) {
				throw err;
			}
		}
	}

	private getDecryptorForPair(pid: string): undefined |
			{ masterDecr: sbox.Decryptor; correspondent: string;
				role: MsgKeyRole; msgKeyPackLen: number; }[] {
		const emails = this.pairIdToEmailMap.getEmails(pid);
		if (!emails) { return; }

		const decryptors: { masterDecr: sbox.Decryptor; correspondent: string;
				role: MsgKeyRole; msgKeyPackLen: number; }[] = [];
		for (const email of emails) {
			const ck = this.corrKeys.get(email);
			if (!ck) { return; }
			const rp = ck.getReceivingPair(pid!);
			if (!rp) { return; }
			const masterKey = base64.open(rp.pair.msgMasterKey);
			const masterDecr = sbox.formatWN.makeDecryptor(masterKey);
			arrays.wipe(masterKey);
			decryptors.push({
				correspondent: email,
				masterDecr,
				role: rp.role,
				msgKeyPackLen: msgKeyPackSizeFor(rp.pair.recipientKey.skey.alg)
			});
		}
		return decryptors;
	}

	private async findEstablishedPairToDecrypt(pid: string,
			getMainObjHeader: () => Promise<Uint8Array>):
			Promise<MsgKeyInfo|undefined> {
		const decryptors = this.getDecryptorForPair(pid);
		if (!decryptors) { return; }
		
		// try to open main object's file key from a header
		const h = await getMainObjHeader();
		for (const d of decryptors) {
			try {
				if (h.length < d.msgKeyPackLen) { continue; }
				const mainObjFileKey = d.masterDecr.open(
					h.subarray(0, d.msgKeyPackLen));
				const info: MsgKeyInfo = {
					correspondent: d.correspondent,
					keyStatus: d.role,
					key: base64.pack(mainObjFileKey),
					msgKeyPackLen: d.msgKeyPackLen
				};
				arrays.wipe(mainObjFileKey);
				return info;
			} catch (err) {
				if (!(err as EncryptionException).failedCipherVerification) {
					throw err;
				}
			} finally {
				d.masterDecr.destroy();
			}
		}
	}
	
	private absorbSuggestedNextKeyPair(correspondent: string,
			pair: SuggestedNextKeyPair, timestamp: number): void {
		let ck = this.corrKeys.get(correspondent);
		if (!ck) {
			ck = this.addCorrespondent(correspondent);
		}
		ck.setSendingPair(pair, timestamp);
		this.saveChanges();
	}

	async decrypt(msgMeta: delivApi.msgMeta.CryptoInfo,
			timestamp: number, getMainObjHeader: () => Promise<Uint8Array>,
			getOpenedMsg: (mainObjFileKey: string, msgKeyPackLen: number) => Promise<OpenedMsg>,
			checkMidKeyCerts: (certs: confApi.p.initPubKey.Certs) =>
				Promise<{ pkey: JsonKey; address: string; }>):
			Promise<{ decrInfo: MsgKeyInfo; openedMsg: OpenedMsg }|undefined> {

		let decrInfo: MsgKeyInfo|undefined;
		let openedMsg: OpenedMsg;
		if (msgMeta.pid) {
			decrInfo = await this.findEstablishedPairToDecrypt(
				msgMeta.pid, getMainObjHeader);
			if (!decrInfo) { return; }
			openedMsg = await getOpenedMsg(decrInfo.key!, decrInfo.msgKeyPackLen);
		} else {
			decrInfo = await this.getDecrytorForIntro(
				msgMeta.recipientKid!, msgMeta.senderPKey!, getMainObjHeader);
			if (!decrInfo) { return; }
			openedMsg = await getOpenedMsg(decrInfo.key!, decrInfo.msgKeyPackLen);
			const certs = openedMsg.getCurrentCryptoCerts();
			const { address, pkey } = await checkMidKeyCerts(certs);
			if (pkey.k !== msgMeta.senderPKey!) { throw new Error(
				`Key certificates in the message are not for a key that encrypted this message.`); }
			decrInfo.correspondent = toCanonicalAddress(address);
		}

		// check that sender is the same as the trusted correspondent
		const sender = openedMsg.getSender();
		if (!sender || !areAddressesEqual(sender, decrInfo.correspondent)) {
			throw new Error(`Mismatch between message sender field '${sender}', and address '${decrInfo.correspondent}', associated with decrypting key.`);
		}

		// absorb next crypto
		const pair = openedMsg.getNextCrypto();
		if (pair) {
			this.absorbSuggestedNextKeyPair(
				decrInfo.correspondent, pair, timestamp);
		}

		return { decrInfo, openedMsg };
	}

	close(): Promise<void> {
		return this.storage.close();
	}
	
	wrap(): KeyRing {
		const wrap: KeyRing = {
			saveChanges: bind(this, this.saveChanges),
			updatePublishedKey: bind(this, this.updatePublishedKey),
			getPublishedKeyCerts: bind(this, this.getPublishedKeyCerts),
			isKnownCorrespondent: bind(this, this.isKnownCorrespondent),
			setCorrepondentTrustedIntroKey: bind(this,
				this.setCorrepondentTrustedIntroKey),
			generateKeysForSendingTo: bind(this, this.generateKeysForSendingTo),
			decrypt: bind(this, this.decrypt),
			getInviteForSendingTo: bind(this, this.getInviteForSendingTo),
			init: bind(this, this.init),
			close: bind(this, this.close)
		};
		Object.freeze(wrap);
		return wrap;
	}
	
}

Object.freeze(exports);