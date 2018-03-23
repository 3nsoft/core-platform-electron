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

import { ASMailKeyPair } from './common';
import { secret_box as sbox } from 'ecma-nacl';
import { JsonKey } from '../../../lib-common/jwkeys';
import { user as mid } from '../../../lib-common/mid-sigs-NaCl-Ed';
import { SuggestedNextKeyPair, OpenedMsg } from '../msg/opener';
import * as delivApi from '../../../lib-common/service-api/asmail/delivery';
import * as confApi from '../../../lib-common/service-api/asmail/config';
import { Ring, MsgKeyInfo, Storage } from './ring';
import { ObjSource } from '../../../lib-common/obj-streaming/common';

export { KEY_USE, MsgKeyRole } from './common';
export { MsgKeyInfo, Storage } from './ring';

export interface KeyRing {
	
	/**
	 * This sets storage and initializes with data, loaded from it.
	 */
	init(storage: Storage): Promise<void>;
	
	/**
	 * This saves key ring, if there are changes, that need to be saved.
	 */
	saveChanges(): void;
	
	/**
	 * This generates a new NaCl's box key pair, setting it as introductory
	 * published key with all respective certificates.
	 * @param signer to create certificates for a new key.
	 */
	updatePublishedKey(signer: mid.MailerIdSigner): void;
	
	/**
	 * @return published certificates for an introductory key,
	 * or undefined, if the key was not set.
	 */
	getPublishedKeyCerts(): confApi.p.initPubKey.Certs | undefined;
	
	/**
	 * This returns true, when given correspondent's address is known, and this
	 * key ring is able to generate keys to send a message. False is returned,
	 * when a given address is unknown, and a lookup on mail server for
	 * introductory key is needed when sending mail to the address. 
	 * @param address
	 */
	isKnownCorrespondent(address: string): boolean;
	
	/**
	 * This function sets a given introductory for a given address. It doesn't
	 * do any verification, therefore, given key must be trusted beforehand via
	 * other means.
	 * @param address of a correspondent
	 * @param pkey is a JWK form of correspondents public key, which to be set
	 * as correspondent's introductory key, that comes not from mail server,
	 * but from other trusted channel.
	 * @param invite is an optional invitation token, which should be used to
	 * send messages to given correspondent.
	 */
	setCorrepondentTrustedIntroKey(address: string,
			pkey: JsonKey, invite?: string): void;
	
	/**
	 * This function generates keys that are need to send a message, i.e.
	 * current crypto encryptor and identifiers to place in message's meta, and
	 * the next suggested crypto material. Returned object has following fields:
	 * (a) encryptor - with encryptor, which should be used to pack message's
	 * main part's key, (b) pairs - contains sendable form for both, current
	 * and suggested pairs.
	 * @param address
	 * @param invitation is an optional invitation token, that should be used
	 * by correspondent with the new suggested pair, i.e. in future replies.
	 * @param introPKeyFromServer is an optional recipient's key from a mail
	 * server. If it is required (check this.shouldLookForIntroKeyOf()), but
	 * is not given, an exception will be thrown.
	 */
	generateKeysForSendingTo(address: string, invitation?: string,
		introPKeyFromServer?: JsonKey): {
			encryptor: sbox.Encryptor;
			pairs: {
				current: ASMailKeyPair;
				next: SuggestedNextKeyPair
			};
		};
	
	/**
	 * This function returns an invite for sending messages to a given
	 * correspondent address. Undefined is returned, when there is no invite
	 * for a given correspondent.
	 * @param correspondent
	 */
	getInviteForSendingTo(correspondent: string): string | undefined;
	
	/**
	 * This function does ring's part of a decryption process, consisting of
	 * (1) finding key material, identified in message meta,
	 * (2) checking that respective keys open the message,
	 * (3) verifying identity of introductory key,
	 * (4) checking that sender header in message corresponds to address,
	 * associated with actual keys, and
	 * (5) absorbing crypto material in the message.
	 * Returned promise resolves to an object with an opened message and a
	 * decryption info, when all goes well, or, otherwise, resolves to undefined.
	 * @param msgMeta is a plain text meta information that comes with the
	 * message
	 * @param timestamp of when message is received. This is used when for
	 * verifying identity certificates, used with introductory keys, to ensure
	 * that those were valid at the time of sending a message.
	 * @param getMainObjHeader getter of message's main object's header
	 * @param getOpenedMsg that opens the message, given file key for the main
	 * object.
	 * @param checkMidKeyCerts is a certifying function for MailerId certs.
	 */
	decrypt(msgMeta: delivApi.msgMeta.CryptoInfo, timestamp: number,
		getMainObjHeader: () => Promise<Uint8Array>,
		getOpenedMsg: (mainObjFileKey: string, msgKeyPackLen: number) =>
			Promise<OpenedMsg>,
		checkMidKeyCerts: (certs: confApi.p.initPubKey.Certs) =>
			Promise<{ pkey: JsonKey; address: string; }>):
		Promise<{ decrInfo: MsgKeyInfo; openedMsg: OpenedMsg }|undefined>;
	
	close(): Promise<void>;
}

/**
 * @return an wrap around newly created key ring object.
 */
export function makeKeyRing(): KeyRing {
	return (new Ring()).wrap();
}

Object.freeze(exports);