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

import * as nacl from 'ecma-nacl';
import { MailerIdProvisioner } from '../lib-client/mailer-id/provisioner';
import { user as mid } from '../lib-common/mid-sigs-NaCl-Ed';
import * as jwk from '../lib-common/jwkeys';
import { base64 } from '../lib-common/buffer-utils';
import { assert } from '../lib-common/assert';
import { bind } from '../lib-common/binding';
import { FileException } from '../lib-common/exceptions/file';
import { errWithCause } from '../lib-common/exceptions/error';
import { getMailerIdServiceFor } from '../lib-client/service-locator';
import { PKLoginException } from '../lib-client/user-with-pkl-session';
import * as xspFS from '../lib-client/3nstorage/xsp-fs/common';
import { areAddressesEqual } from '../lib-common/canonical-address';

let CERTIFICATE_DURATION_SECONDS = 16*60*60;
let ASSERTION_VALIDITY = 15*60;

let MIN_SECS_LEFT_ASSUMED_OK = 60;

/**
 * This function completes provisioning process, returning a promise, resolvable
 * to either true, when all is done, or to false, when challenge reply is not
 * accepted by the server.
 */
export interface CompleteProvisioning {
	keyParams: any;
	complete(loginSKey: Uint8Array): Promise<boolean>;
}

export interface IdManager {

	/**
	 * @param address
	 * @return a promise, resolvable either to provisioning completion function,
	 * or to null, if given address is unknown.
	 */
	provisionNew(address: string): Promise<CompleteProvisioning>;
	
	/**
	 * This sets address for those situations, when provisioning is done from
	 * locally saved key.
	 */
	setAddress(address: string): void;
	
	getId(): string;
	
	/**
	 * @return a promise, resolvable to mailerId signer.
	 */
	getSigner(): Promise<mid.MailerIdSigner>;
	
	/**
	 * @return true, if signer for a given id has been provisioned, and
	 * shall be valid at least for the next minute, and false, otherwise.
	 */
	isProvisionedAndValid(): boolean;
	
	/**
	 * This sets manager's storage file system.
	 * If an identity has already been provisioned, this method ensures that
	 * key is recorded in the storage, else, if identity hasn't been set, this
	 * method tries to read key file, and set identity with it.
	 */
	setStorage(fs: xspFS.FS): Promise<void>;
	
}

let LOGIN_KEY_FILE_NAME = 'login-keys';

let PROVISIONING_LOGIN_KEY_USE = 'malierid-prov-login';
let DEFAULT_KEY_ID = 'default';

interface LoginKeysJSON {
	address: string;
	defaultKey: jwk.JsonKey;
	nonDefaultKeys: jwk.JsonKey[];
}

class Manager implements IdManager {
	
	private address: string = null;
	private signer: mid.MailerIdSigner = null;
	private skeyFromPass: Uint8Array = null;
	private fs: xspFS.FS = null;
	private provisioningProc: Promise<mid.MailerIdSigner> = null;
	
	constructor() {
		Object.seal(this);
	}
	
	private clearSKeyFromPass(): void {
		nacl.arrays.wipe(this.skeyFromPass);
		this.skeyFromPass = null;
	}
	
	setAddress(address: string): void {
		if (this.address) { throw new Error(
			'Identity is already set to '+this.address); }
		this.address = address;
	}
	
	async setStorage(fs: xspFS.FS): Promise<void> {
		if (this.fs) { throw new Error('Storage fs is already set'); }
		try {
			this.fs = fs;
			if (!this.isProvisionedAndValid()) {
				assert(this.skeyFromPass === null);
				let json = await this.fs.readJSONFile<LoginKeysJSON>(
					LOGIN_KEY_FILE_NAME);
				if (!areAddressesEqual(json.address, this.address)) {
					throw new Error('Address for login keys on file does not match address set in id manager.'); }
				return;
			}
			assert(this.skeyFromPass !== null);
			try {
				let json = await this.fs.readJSONFile<LoginKeysJSON>(
					LOGIN_KEY_FILE_NAME);
				// - compare pass-key with default key
				if (json.defaultKey.k !== base64.pack(this.skeyFromPass)) {
					json.defaultKey = jwk.keyToJson({
						k: this.skeyFromPass,
						kid: DEFAULT_KEY_ID,
						alg: nacl.box.JWK_ALG_NAME,
						use: PROVISIONING_LOGIN_KEY_USE
					});
					await this.fs.writeJSONFile(LOGIN_KEY_FILE_NAME, json);
				}
			} catch (err) {
				if (!(<FileException> err).notFound) { throw err; }
				let json: LoginKeysJSON = {
					address: this.address,
					defaultKey: jwk.keyToJson({
						k: this.skeyFromPass,
						kid: DEFAULT_KEY_ID,
						alg: nacl.box.JWK_ALG_NAME,
						use: PROVISIONING_LOGIN_KEY_USE
					}),
					nonDefaultKeys: []
				};
				await this.fs.writeJSONFile(LOGIN_KEY_FILE_NAME, json);
			}
			this.clearSKeyFromPass();
		} catch (err) {
			throw errWithCause(err, 'Failed to set storage for MailerId');
		}
	}
	
	async provisionNew(address: string): Promise<CompleteProvisioning> {
		if (this.address) { throw new Error(
			'Identity is already set to '+this.address); }
		let midUrl = await getMailerIdServiceFor(address);
		let provisioner = new MailerIdProvisioner(address, midUrl);
		try {
			let provisioning = await provisioner.provisionSigner();
			let completion = async (loginSKey: Uint8Array): Promise<boolean> => {
				this.skeyFromPass = loginSKey;
				try {
					this.signer = await provisioning.complete(() => {
							return nacl.box.calc_dhshared_key(
								provisioning.serverPKey, this.skeyFromPass);
						},
						CERTIFICATE_DURATION_SECONDS, ASSERTION_VALIDITY);
					this.address = address;
					return true;
				} catch (err) {
					if ((<PKLoginException> err).cryptoResponseNotAccepted) {
						return false;
					} else {
						throw err;
					}
				}
			};
			return {
				keyParams: provisioning.keyParams,
				complete: completion
			};
		} catch (err) {
			if (err.unknownUser) {
				return;
			} else {
				throw err;
			}
		}
	}
	
	private provisionUsingSavedKey(): Promise<mid.MailerIdSigner> {
		if (this.provisioningProc) { return this.provisioningProc; }
		this.provisioningProc = (async () => {
			let midUrl = await getMailerIdServiceFor(this.address);
			let provisioner = new MailerIdProvisioner(this.address, midUrl);
			let provisioning = await provisioner.provisionSigner();
			let json = await this.fs.readJSONFile<LoginKeysJSON>(
				LOGIN_KEY_FILE_NAME);
			let skey = base64.open(json.defaultKey.k);
			this.signer = await provisioning.complete(() => {
				return nacl.box.calc_dhshared_key(provisioning.serverPKey, skey);
			}, CERTIFICATE_DURATION_SECONDS, ASSERTION_VALIDITY);
			return this.signer;
		})();
		return this.provisioningProc
	}
		
	getId(): string {
		return this.address;
	}
	
	async getSigner(): Promise<mid.MailerIdSigner> {
		if (!this.isProvisionedAndValid()) {
			await this.provisionUsingSavedKey()
		}
		return this.signer;
	}
	
	isProvisionedAndValid(): boolean {
		if (!this.signer) { return false; }
		if (this.signer.certExpiresAt >=
				(Date.now()/1000 + MIN_SECS_LEFT_ASSUMED_OK)) {
			return true;
		} else {
			this.signer = null;
			return false;
		}
	}
	
}

export function makeManager(): IdManager {
	let m = new Manager();
	let managerWrap: IdManager = {
		setStorage: bind(m, m.setStorage),
		provisionNew: bind(m, m.provisionNew),
		getId: bind(m, m.getId),
		getSigner: bind(m, m.getSigner),
		isProvisionedAndValid: bind(m, m.isProvisionedAndValid),
		setAddress: bind(m, m.setAddress)
	};
	Object.freeze(managerWrap);
	return managerWrap;
}

Object.freeze(exports);