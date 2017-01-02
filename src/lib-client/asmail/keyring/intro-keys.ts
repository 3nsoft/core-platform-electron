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

import { JWKeyPair, generateKeyPair, MsgKeyRole } from './common';
import * as confApi from '../../../lib-common/service-api/asmail/config';
import { user as mid } from '../../../lib-common/mid-sigs-NaCl-Ed';
import { Ring } from './ring';

const INTRO_KEY_VALIDITY = 31*24*60*60;

interface IntroKeysJSON {
	publishedKey: JWKeyPair|null;
	publishedKeyCerts: confApi.p.initPubKey.Certs|null;
	retiredPublishedKey: JWKeyPair|null;
	otherIntroKeys: {
		[kid: string]: JWKeyPair;
	};
}

/**
 * This is a container of key pairs that are used as introductory keys, either
 * published, or not.
 */
export class IntroKeysContainer {
	
	private keys: IntroKeysJSON;
	get publishedKeyCerts(): confApi.p.initPubKey.Certs|null {
		return this.keys.publishedKeyCerts;
	}
	
	/**
	 * @param keyring
	 * @param serialForm is an optional string, from which data should be loaded.
	 */
	constructor(
			private keyring: Ring,
			serialForm: string|null = null) {
		if (serialForm) {
			let data = JSON.parse(serialForm);
			// TODO checks of deserialized json data
			
			this.keys = data;
		} else {
			this.keys = {
				publishedKey: null,
				publishedKeyCerts: null,
				retiredPublishedKey: null,
				otherIntroKeys: {}
			};
		}
	}

	/**
	 * @return json object for serialization.
	 */
	serialForm(): string {
		return JSON.stringify(this.keys);
	}

	/**
	 * This generates a new NaCl's box key pair, as a new introductory
	 * published key.
	 */
	updatePublishedKey(signer: mid.MailerIdSigner): void {
		let pair = generateKeyPair();
		pair.createdAt = Date.now();
		if (this.keys.publishedKey) {
			this.keys.publishedKey.retiredAt = pair.createdAt;
			this.keys.retiredPublishedKey = this.keys.publishedKey;
		}
		this.keys.publishedKey = pair;
		this.keys.publishedKeyCerts = {
			pkeyCert: signer.certifyPublicKey(
				this.keys.publishedKey.pkey, INTRO_KEY_VALIDITY),
			userCert: signer.userCert,
			provCert: signer.providerCert
		};
	}

	/**
	 * @param kid
	 * @return if key is found, object with following fields is returned:
	 *         (a) pair is JWK key pair;
	 *         (b) role with a value from KEY_ROLE;
	 *         (c) replacedAt field comes for KEY_ROLE.PREVIOUSLY_PUBLISHED_INTRO
	 *             keys, telling, in milliseconds, when this key was superseded
	 *             in use by a newer one;
	 *         Undefined is returned, when a key is not found.
	 */
	findKey(kid: string): undefined |
			{ role: MsgKeyRole; pair: JWKeyPair; replacedAt?: number; } {

		// check published key
		let key = this.keys.publishedKey;
		if (key && (key.skey.kid === kid)) {
			return {
				role: 'published_intro',
				pair: key
			};
		}
		
		// check retired published key
		key = this.keys.retiredPublishedKey;
		if (key && (key.skey.kid === kid)) {
			return {
				role: 'prev_published_intro',
				pair: key,
				replacedAt: key.retiredAt
			};
		}
		
		// check other unpublished introductory keys
		key = this.keys.otherIntroKeys[kid];
		if (key) {
			return {
				role: 'introductory',
				pair: key
			};
		}
		
		// if nothing found return undefined
		return;	
	}
	
}
Object.freeze(IntroKeysContainer);
Object.freeze(IntroKeysContainer.prototype);

Object.freeze(exports);