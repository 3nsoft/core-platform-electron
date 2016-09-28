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
import * as util from './common';
import { box, secret_box as sbox, arrays } from 'ecma-nacl';
import { JsonKey, JsonKeyShort, keyToJson } from '../../../lib-common/jwkeys';
import { user as mid } from '../../../lib-common/mid-sigs-NaCl-Ed';
import { SuggestedNextKeyPair } from '../msg';
import * as delivApi from '../../../lib-common/service-api/asmail/delivery';
import * as confApi from '../../../lib-common/service-api/asmail/config';
import * as indexMod from './index';
import * as random from '../../random-node';
import { bind } from '../../../lib-common/binding';

function makeSendingEncryptor(senderPair: SendingPair): sbox.Encryptor {
	let skey = util.extractSKeyBytes(senderPair.senderKey.skey);
	let pkey = util.extractKeyBytes(senderPair.recipientPKey);
	let nextNonce = random.bytes(box.NONCE_LENGTH);
	return box.formatWN.makeEncryptor(pkey, skey, nextNonce);
}

function makeReceivingDecryptorAndKey(
		pkeyJW: JsonKeyShort, skeyJW: JsonKey):
		{ decr: sbox.Decryptor; key: JsonKey; } {
	let skey = util.extractSKeyBytes(skeyJW);
	let pkey = util.extractKeyBytes(pkeyJW);
	let dhSharedKey = box.calc_dhshared_key(pkey, skey);
	let decr = sbox.formatWN.makeDecryptor(dhSharedKey);
	let keyJSON = keyToJson({ k: dhSharedKey, kid: '', use: '',
		alg: sbox.JWK_ALG_NAME });
	arrays.wipe(skey, pkey, dhSharedKey);
	return {
		decr: decr,
		key: keyJSON
	};
}

function selectPid(pids: string[]): string {
	if (pids.length < 1) { throw new Error("There are no pair ids in array."); }
	let i = Math.round((pids.length-1) * random.uint8()/255);
	return pids[i];
}

interface RingJSON {
	corrKeys: string[];
	introKeys: string;
}

export class Ring implements indexMod.KeyRing {
	
	introKeys: IntroKeysContainer = null;
	corrKeys = new Map<string, CorrespondentKeys>();
	introKeyIdToEmailMap = new IdToEmailMap();
	pairIdToEmailMap = new IdToEmailMap();
	private storage: indexMod.Storage = null;
	
	constructor() {
		Object.seal(this);
	}
	
	private addCorrespondent(address: string, serialForm: string = null):
			CorrespondentKeys {
		let ck = (serialForm ?
			new CorrespondentKeys(this, null, serialForm) :
			new CorrespondentKeys(this, address, null));
		if (this.corrKeys.has(ck.correspondent)) { throw new Error(
			"Correspondent with address "+ck.correspondent+
			" is already present."); }
		this.corrKeys.set(ck.correspondent, ck);
		if (serialForm) {
			ck.mapAllKeysIntoRing();
		}
		return ck;
	}
	
	async init(storage: indexMod.Storage): Promise<void> {
		if (this.storage) { throw new Error(
			"Keyring has already been initialized."); }
		this.storage = storage;
		let serialForm = await this.storage.load();
		if (serialForm) {
			let json: RingJSON = JSON.parse(serialForm);
			// TODO check json's fields
			
			// init data
			this.introKeys = new IntroKeysContainer(
				this, json.introKeys);
			json.corrKeys.forEach((info) => {
				this.addCorrespondent(null, info);
			});
		} else {
			this.introKeys = new IntroKeysContainer(this);
			// save initial file, as there was none initially
			this.saveChanges();
		}
	}

	saveChanges(): Promise<void> {
		// pack bytes that need to be encrypted and saved
		let dataToSave = <RingJSON> {
			introKeys: this.introKeys.serialForm(),
			corrKeys: []
		};
		for (let corrKeys of this.corrKeys.values()) {
			dataToSave.corrKeys.push(corrKeys.serialForm());
		}
		// trigger saving utility
		return this.storage.save(JSON.stringify(dataToSave));
	}
	
	updatePublishedKey(signer: mid.MailerIdSigner): void {
		this.introKeys.updatePublishedKey(signer);
		this.saveChanges();
	}
	
	getPublishedKeyCerts(): confApi.p.initPubKey.Certs {
		if (this.introKeys.publishedKeyCerts) {
			return this.introKeys.publishedKeyCerts;
		}
		return;	// undefined
	}

	isKnownCorrespondent(address: string): boolean {
		return this.corrKeys.has(address);
	}
	
	setCorrepondentTrustedIntroKey(address: string, pkey: JsonKey,
			invite: string = null): void {
		let ck = this.corrKeys.get(address);
		if (!ck) {
			ck = this.addCorrespondent(address);
		}
		ck.setIntroKey(pkey, invite);
		this.saveChanges();
	}
	
	absorbSuggestedNextKeyPair(correspondent: string,
			pair: SuggestedNextKeyPair, timestamp: number): void {
		let ck = this.corrKeys.get(correspondent);
		if (!ck) {
			ck = this.addCorrespondent(correspondent);
		}
		ck.setSendingPair(pair, timestamp);
		this.saveChanges();
	}
	
	getInviteForSendingTo(correspondent: string): string {
		let ck = this.corrKeys.get(correspondent);
		return (ck ? ck.invite : null);
		
	}
	
	markPairAsInUse(correspondent: string, pid: string) {
		this.corrKeys.get(correspondent).markPairAsInUse(pid);
		this.saveChanges();
	}
	
	generateKeysForSendingTo(address: string, invitation: string = null,
			introPKeyFromServer: JsonKey = null): {
				encryptor: sbox.Encryptor;
				pairs: { current: util.ASMailKeyPair;
						next: SuggestedNextKeyPair; }; } {
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
		let encryptor = makeSendingEncryptor(sendingPair);
		let suggestPair = ck.suggestPair(invitation);
		let currentPair: util.ASMailKeyPair;
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

	getDecryptorFor(pair: delivApi.msgMeta.CryptoInfo):
			indexMod.DecryptorWithInfo[] {
		let decryptors: indexMod.DecryptorWithInfo[] = [];
		if (pair.pid) {
			let emails = this.pairIdToEmailMap.getEmails(pair.pid);
			if (!emails) { return; }
			emails.forEach((email) => {
				let ck = this.corrKeys.get(email);
				let rp = ck.getReceivingPair(pair.pid);
				let decryptorAndKey = makeReceivingDecryptorAndKey(
						rp.pair.senderPKey, rp.pair.recipientKey.skey);
				decryptors.push({
					correspondent: email,
					decryptor: decryptorAndKey.decr,
					key: decryptorAndKey.key,
					cryptoStatus: rp.role
				});
			});
		} else {
			let recipKey = this.introKeys.findKey(pair.recipientKid);
			if (!recipKey) { return; }
			let decryptorAndKey = makeReceivingDecryptorAndKey(
				{
					kid: '',
					k: pair.senderPKey
				},
				recipKey.pair.skey);
			decryptors.push({
				decryptor: decryptorAndKey.decr,
				key: decryptorAndKey.key,
				cryptoStatus: recipKey.role
			});
		}
		return decryptors;
	}
	
	wrap(): indexMod.KeyRing {
		let wrap: indexMod.KeyRing = {
			saveChanges: bind(this, this.saveChanges),
			updatePublishedKey: bind(this, this.updatePublishedKey),
			getPublishedKeyCerts: bind(this, this.getPublishedKeyCerts),
			isKnownCorrespondent: bind(this, this.isKnownCorrespondent),
			setCorrepondentTrustedIntroKey: bind(this,
				this.setCorrepondentTrustedIntroKey),
			generateKeysForSendingTo: bind(this, this.generateKeysForSendingTo),
			getDecryptorFor: bind(this, this.getDecryptorFor),
			absorbSuggestedNextKeyPair: bind(this,
				this.absorbSuggestedNextKeyPair),
			getInviteForSendingTo: bind(this, this.getInviteForSendingTo),
			init: bind(this, this.init)
		};
		Object.freeze(wrap);
		return wrap;
	}
	
}

Object.freeze(exports);