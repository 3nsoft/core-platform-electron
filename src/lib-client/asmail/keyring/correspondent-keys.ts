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
 * This file contains functionality, used inside keyring.
 */

import { JWKeyPair, PID_LENGTH, extractPKeyBytes, generateKeyPair,
	extractKeyBytes, MsgKeyRole, extractSKeyBytes } from './common';
import { JsonKey, JsonKeyShort } from '../../../lib-common/jwkeys';
import { SuggestedNextKeyPair } from '../msg';
import { Ring } from './ring';
import * as random from '../../random-node';
import { box, arrays } from 'ecma-nacl';
import { base64 } from '../../../lib-common/buffer-utils';
import { errWithCause } from '../../../lib-common/exceptions/error';

export interface ReceptionPair {
	pids: string[];
	recipientKey: JWKeyPair;
	senderPKey: JsonKeyShort;
	msgMasterKey: string;
	invitation?: string;
}

export interface SendingPair {
	pids: string[];
	recipientPKey: JsonKeyShort;
	senderKey: JWKeyPair;
	msgMasterKey: string;
	isSelfGenerated?: boolean;
}

function generatePids(): string[] {
	let pids: string[] = [];
	for (let i=0; i<5; i+=1) {
		pids[i] = random.stringOfB64Chars(PID_LENGTH);
	}
	return pids;
}

function calcMsgMasterKey(skey: JsonKey, pkey: JsonKeyShort): string {
	let sk = extractSKeyBytes(skey);
	let pk = extractKeyBytes(pkey);
	let dhShared = box.calc_dhshared_key(pk, sk);
	let mmKey = base64.pack(dhShared);
	arrays.wipe(sk, pk, dhShared);
	return mmKey;
}

interface CorrespondentKeysJSON {
	
	/**
	 * This is correspondent's address.
	 */
	correspondent: string;
	
	/**
	 * This is an invitation token, which should be used to send messages to
	 * correspondent.
	 */
	inviteForSending: string|null;
	
	/**
	 * Correspondent's introductory public key that comes from some 3rd channel.
	 * It is used to initiate mail exchange, without relying on key, served
	 * by correspondent's mail server.
	 */
	introKey: JsonKey|null;
	
	/**
	 * Sending pair is used for sending messages to this recipient.
	 * It is set from suggestions that correspondent sends in her messages.
	 * When initiating an exchange, while this pair has not been set, it is
	 * generated, which is indicated by the flag.
	 */
	sendingPair: SendingPair|null;
	
	sendingPairTS: number;
	
	/**
	 * Reception key pairs are pairs which we suggest to this correspondent
	 * for sending messages to us.
	 * Suggested pair is the one that we have already suggested, or are
	 * suggesting now.
	 * When correspondent uses suggested pair, we move it to inUse, while
	 * previous inUse pair is moved to old.
	 */
	receptionPairs: {
		suggested: ReceptionPair|null;
		inUse: ReceptionPair|null;
		old: ReceptionPair|null;
	};
}

export class CorrespondentKeys {

	private keys: CorrespondentKeysJSON = (undefined as any);
	get correspondent(): string {
		return this.keys.correspondent;
	}
	get invite(): string|null {
		return this.keys.inviteForSending;
	}
	set invite(invite: string|null) {
		this.keys.inviteForSending = invite;
	}
	
	/**
	 * @param keyring in which these keys are hanging.
	 * @param address of this correspondent.
	 * Either serialData, or an address should be defined, not both.
	 * @param serialData from which this object should be reconstructed.
	 * Either serialData, or an address should be defined, not both.
	 */
	constructor(
			private keyring: Ring,
			address: string|undefined, serialData?: string) {
		if (address) {
			this.keys = {
				correspondent: address,
				inviteForSending: null,
				introKey: null,
				sendingPair: null,
				sendingPairTS: 0,
				receptionPairs: {
					suggested: null,
					inUse: null,
					old: null
				}
			};
		} else {
			let data: CorrespondentKeysJSON = JSON.parse(serialData!);
			// TODO checks of deserialized json data
			
			this.keys = data;
		}
		Object.seal(this);
	}
	
	/**
	 * This attaches all keys into ring's maps.
	 * Theis method should be called only once, and only on a deserialized
	 * object.
	 */
	mapAllKeysIntoRing(): void {
		// index correspondent's key
		if (this.keys.introKey) {
			this.keyring.introKeyIdToEmailMap.addPair(
					this.keys.introKey.kid, this.correspondent);
		}
		// index key pairs
		let pairs = [ this.keys.receptionPairs.suggested,
	    	          this.keys.receptionPairs.inUse,
	        	      this.keys.receptionPairs.old ];
		let email = this.correspondent;
		pairs.forEach((pair) => {
			if (!pair) { return; }
			pair.pids.forEach((pid) => {
				this.keyring.pairIdToEmailMap.addPair(pid, email);
			});
		});
	}

	/**
	 * @return json object for serialization.
	 */
	serialForm(): string {
		return JSON.stringify(this.keys);
	}

	/**
	 * Correctly remove previous key and attaches a new correspondent's
	 * introductory public key, performing keyring's update and save.
	 * @param pkey
	 * @param invite
	 * correspondent's mail server.
	 */
	setIntroKey(pkey: JsonKey, invite: string): void {
		try {
			extractPKeyBytes(pkey);
		} catch (err) {
			throw errWithCause(err, "Given public key cannot be used");
		}
		// remove existing key, if there is one, from keyring's index
		if (this.keys.introKey) {
			this.keyring.introKeyIdToEmailMap.removePair(
					this.keys.introKey.kid, this.correspondent);
		}
		this.keys.introKey = pkey;
		// add new key to keyring's index
		this.keyring.introKeyIdToEmailMap.addPair(
				this.keys.introKey.kid, this.correspondent);
		this.keys.inviteForSending = invite;
	}
	
	/**
	 * This function generates new suggested reception pair, but only if there
	 * is currently none.
	 * If there is previous suggested pair, it shall be returned.
	 * @param invitation is an invitation string, for use with a new key pair.
	 * It can be undefined. When undefined, new chain of pairs shall start
	 * without a token, while existing one will use whatever token has been used
	 * already (if any).
	 * @return reception pair, which should be suggested to correspondent.
	 */
	suggestPair(invitation: string|undefined): SuggestedNextKeyPair {
		
		// reuse previously suggested pair
		if (this.keys.receptionPairs.suggested) {
			let p = this.keys.receptionPairs.suggested;
			let nextKeyPair: SuggestedNextKeyPair = {
				pids: p.pids,
				senderKid: p.senderPKey.kid,
				recipientPKey: p.recipientKey.pkey
			};
			if (invitation) {
				nextKeyPair.invitation = invitation;
			} else if (p.invitation) {
				nextKeyPair.invitation = p.invitation; 
			}
			return nextKeyPair;
		}

		// generate new suggested pair
		if (!this.keys.sendingPair) { throw new Error(
				"Sending pair should be set before calling this function."); }
		let corrPKey = this.keys.sendingPair.recipientPKey;
		let recipientKey = generateKeyPair();
		let msgMasterKey = calcMsgMasterKey(recipientKey.skey, corrPKey);
		let pair: ReceptionPair = {
				pids: generatePids(),
				recipientKey,
				senderPKey: corrPKey,
				msgMasterKey
		};
		if (invitation) {
			pair.invitation = invitation;
		}
		this.keys.receptionPairs.suggested = pair;

		// add pair to index
		this.keyring.pairIdToEmailMap.addPairs(pair.pids, this.correspondent);
		this.keyring.saveChanges();

		let nextKeyPair: SuggestedNextKeyPair = {
			pids: pair.pids,
			senderKid: pair.senderPKey.kid,
			recipientPKey: pair.recipientKey.pkey
		};
		if (pair.invitation) {
			nextKeyPair.invitation = pair.invitation;
		}
		return nextKeyPair;
	}

	/**
	 * This marks suggested reception pair as being in use, if it has the same
	 * id as a given pid.
	 * Otherwise, nothing happens.
	 * Suggested pair is moved into category in-use, while in-use pair is
	 * reclassified as old.
	 * @param pid
	 */
	markPairAsInUse(pid: string): void {
		if (!this.keys.receptionPairs.suggested ||
			(this.keys.receptionPairs.suggested.pids.indexOf(pid) < 0)) { return; }
		let mp = this.keys.receptionPairs.inUse;
		this.keys.receptionPairs.inUse = this.keys.receptionPairs.suggested;
		if (mp) {
			let dp = this.keys.receptionPairs.old;
			this.keys.receptionPairs.old = mp;
			if (dp) {
				dp.pids.forEach((pid) => {
					this.keyring.pairIdToEmailMap.removePair(
						pid, this.correspondent);
				});
			}
		}
	}
	
	/**
	 * This function is used internally in this.setSendingPair(p) function.
	 * @param kid
	 * @return a key for receiving, corresponding to given key id.
	 */
	private findReceptionKey(kid: string): JWKeyPair {
		for (let fieldName of Object.keys(this.keys.receptionPairs)) {
			let rp: ReceptionPair = this.keys.receptionPairs[fieldName];
			if (!rp) { continue; }
			if (rp.recipientKey.skey.kid === kid) {
				return rp.recipientKey;
			}
		}
		let keyInfo = this.keyring.introKeys.findKey(kid);
		if (keyInfo) {
			return keyInfo.pair;
		} else {
			let err = new Error("Key cannot be found");
			(<any> err).unknownKid = true;
			throw err;
		}
	}

	/**
	 * This checks given pair and sets a new sending pair.
	 * @param pair
	 * @param timestamp
	 */
	setSendingPair(pair: SuggestedNextKeyPair, timestamp: number): void {
		if (this.keys.sendingPairTS >= timestamp) { return; }
		let senderKey = this.findReceptionKey(pair.senderKid);
		try {
			let msgMasterKey = calcMsgMasterKey(
				senderKey.skey, pair.recipientPKey);
			this.keys.sendingPair = {
					pids: pair.pids,
					recipientPKey: pair.recipientPKey,
					senderKey: senderKey,
					msgMasterKey
			};
			if (pair.invitation) {
				this.keys.inviteForSending = pair.invitation;
			}
			this.keys.sendingPairTS = timestamp;
		} catch (err) {
			throw errWithCause(err, "Public key in a given pair cannot be used");
		}
	}
	
	/**
	 * @param pid
	 * @return pair for receiving messages and a role of a given pair.
	 * Undefined is returned when no pair were found.
	 */
	getReceivingPair(pid: string):
			{ pair: ReceptionPair; role: MsgKeyRole; } | undefined {
		let pairs = this.keys.receptionPairs;
		if (pairs.suggested && (pairs.suggested.pids.indexOf(pid) >= 0)) {
			return {
				pair: pairs.suggested,
				role: 'suggested'
			};
		} else if (pairs.inUse && (pairs.inUse.pids.indexOf(pid) >= 0)) {
			return {
				pair: pairs.inUse,
				role: 'in_use'
			};
		} else if (pairs.old && (pairs.old.pids.indexOf(pid) >= 0)) {
			return {
				pair: pairs.old,
				role: 'old'
			};
		}
		return;	// explicit return of undefined
	}
	
	/**
	 * @param corrIntroKey is a correspondent's intro key, required, when there
	 * is no introKey.
	 * @return existing sending pair, or generates a new one.
	 */
	getSendingPair(corrIntroKey?: JsonKey): SendingPair {
		if (this.keys.sendingPair) { return this.keys.sendingPair; }
		let senderKey = generateKeyPair();
		let recipientPKey = (corrIntroKey ? corrIntroKey : this.keys.introKey);
		if (!recipientPKey) { throw new Error("Introductory key for "+
			this.correspondent+" is neither given, nor present in the ring."); }
		let msgMasterKey = calcMsgMasterKey(senderKey.skey, recipientPKey);
		this.keys.sendingPair = {
				pids: generatePids(),
				recipientPKey: recipientPKey,
				senderKey: senderKey,
				isSelfGenerated: true,
				msgMasterKey
		};
		this.keyring.saveChanges();
		return this.keys.sendingPair;
	}
	
}
Object.freeze(CorrespondentKeys.prototype);
Object.freeze(CorrespondentKeys);

Object.freeze(exports);