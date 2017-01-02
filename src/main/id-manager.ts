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

import { arrays, box } from 'ecma-nacl';
import { MailerIdProvisioner } from '../lib-client/mailer-id/provisioner';
import { user as mid } from '../lib-common/mid-sigs-NaCl-Ed';
import { JsonKey, keyToJson, keyFromJson, use as keyUse }
	from '../lib-common/jwkeys';
import { base64 } from '../lib-common/buffer-utils';
import { assert } from '../lib-common/assert';
import { bind } from '../lib-common/binding';
import { FileException } from '../lib-common/exceptions/file';
import { errWithCause } from '../lib-common/exceptions/error';
import { getMailerIdServiceFor } from '../lib-client/service-locator';
import { PKLoginException } from '../lib-client/user-with-pkl-session';
import { FS } from '../lib-client/3nstorage/xsp-fs/common';
import { areAddressesEqual } from '../lib-common/canonical-address';
import { SingleProc } from '../lib-common/processes';

let CERTIFICATE_DURATION_SECONDS = 16*60*60;
let ASSERTION_VALIDITY = 15*60;

let MIN_SECS_LEFT_ASSUMED_OK = 10*60;

/**
 * This function completes provisioning process, returning a promise, resolvable
 * to either true, when all is done, or to false, when challenge reply is not
 * accepted by the server.
 */
export interface CompleteProvisioning {
	keyParams: any;
	complete(defaultSKey: Uint8Array): Promise<boolean>;
}

export interface IdManager {

	/**
	 * This returns a promise, resolvable either to provisioning completion
	 * function, or to null, if given address is unknown.
	 * @param address
	 */
	provisionNew(address: string): Promise<CompleteProvisioning>;
	
	/**
	 * This sets address for those situations, when provisioning is done from
	 * locally saved key.
	 */
	setAddress(address: string): void;
	
	/**
	 * This returns user id, address, for which this id manager is provisioned.
	 */
	getId(): string;
	
	/**
	 * This returns a promise, resolvable to mailerId signer.
	 */
	getSigner(): Promise<mid.MailerIdSigner>;
	
	/**
	 * This returns true, if signer for a given id has been provisioned, and
	 * shall be valid at least for the next minute, and false, otherwise.
	 */
	isProvisionedAndValid(): boolean;
	
	/**
	 * This sets manager's storage file system.
	 * If an identity has already been provisioned, this method ensures that
	 * key is recorded in the storage, else, if identity hasn't been set, this
	 * method tries to read key file, and set identity with it.
	 */
	setStorage(fs: FS): Promise<void>;

	/**
	 * This function should be used when user is created, and login non-default
	 * keys should be recorded for future use, as corresponding public keys have
	 * been set on server.
	 */
	setLoginKeys(keysToSave: JsonKey[]): void;
	
}

let LOGIN_KEY_FILE_NAME = 'login-keys';

let PROVISIONING_LOGIN_KEY_USE = 'malierid-prov-login';
let DEFAULT_KEY_ID = 'default';

interface LoginKeysJSON {
	address: string;
	keys: JsonKey[];
}

class Manager implements IdManager {
	
	private address: string = (undefined as any);
	private signer: mid.MailerIdSigner = (undefined as any);
	private fs: FS = (undefined as any);
	private provisioningProc = new SingleProc<mid.MailerIdSigner>();

	/**
	 * These keys should be set only when user is created.
	 */
	private keysToSave: JsonKey[]|undefined = undefined;
	
	constructor() {
		Object.seal(this);
	}
	
	setAddress(address: string): void {
		if (this.address) { throw new Error(
			'Identity is already set to '+this.address); }
		this.address = address;
	}

	setLoginKeys(keysToSave: JsonKey[]): void {
		if (this.fs) { throw new Error(`Setting keys for saving must be done before setting fs, in this implementation.`); }
		this.keysToSave = keysToSave;
	}
	
	private async checkKeyFile(): Promise<void> {
		let json = await this.fs.readJSONFile<LoginKeysJSON>(
			LOGIN_KEY_FILE_NAME);
		if (!areAddressesEqual(json.address, this.address)) { throw new Error(
			'Address for login keys on file does not match address set in id manager.'); }
		if (!Array.isArray(json.keys) || (json.keys.length < 1)) {
			throw new Error('Missing login keys on file.'); }
		try {
			for (let jkey of json.keys) {
				keyFromJson(jkey, keyUse.MID_PKLOGIN, box.JWK_ALG_NAME, box.KEY_LENGTH);
			}
		} catch (err) {
			throw errWithCause(err, 'Invalid login key(s) on file.');
		}
	}

	async setStorage(fs: FS): Promise<void> {
		if (this.fs) { throw new Error('Storage fs is already set.'); }
		this.fs = fs;
		try {

			// Signer is provisioned before setting fs only when initialization
			// is performed with a default key, derived from password.
			if (this.isProvisionedAndValid()) {
				// We have two cases here:
				// 1) this is a creation of the user, and we want to save login
				// keys.
				// 2) this is an initialization on a new device, and we want to
				// only check key file.
				if (this.keysToSave) {
					let json: LoginKeysJSON = {
						address: this.address,
						keys: this.keysToSave
					};
					await this.fs.writeJSONFile(
						LOGIN_KEY_FILE_NAME, json, true, true);
				} else {
					await this.checkKeyFile();
				}
			} else {
				// Initialization is performed from an existing storage, and we
				// only want to only check file with keys.
				await this.checkKeyFile();
			}

		} catch (err) {
			throw errWithCause(err, 'Failed to set storage for MailerId.');
		}
	}
	
	async provisionNew(address: string):
			Promise<CompleteProvisioning|undefined> {
		if (this.address) { throw new Error(
			'Identity is already set to '+this.address); }
		let midUrl = await getMailerIdServiceFor(address);
		let provisioner = new MailerIdProvisioner(address, midUrl);
		try {
			let provisioning = await provisioner.provisionSigner(undefined);
			let completion = async (defaultSKey: Uint8Array): Promise<boolean> => {
				try {
					this.signer = await provisioning.complete(() => {
							let dhshared = box.calc_dhshared_key(
								provisioning.serverPKey, defaultSKey);
							arrays.wipe(defaultSKey);
							return dhshared;
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
		let proc = this.provisioningProc.getP();
		if (proc) { return proc; }
		proc = this.provisioningProc.start(async () => {
			let midUrl = await getMailerIdServiceFor(this.address);
			let provisioner = new MailerIdProvisioner(this.address, midUrl);
			let json = await this.fs.readJSONFile<LoginKeysJSON>(
				LOGIN_KEY_FILE_NAME);
			let skey = keyFromJson(json.keys[0], keyUse.MID_PKLOGIN,
				box.JWK_ALG_NAME, box.KEY_LENGTH);
			let provisioning = await provisioner.provisionSigner(skey.kid);
			this.signer = await provisioning.complete(() => {
				let dhshared = box.calc_dhshared_key(
					provisioning.serverPKey, skey.k);
				arrays.wipe(skey.k);
				return dhshared;
			}, CERTIFICATE_DURATION_SECONDS, ASSERTION_VALIDITY);
			return this.signer;
		});
		return proc;
	}
		
	getId(): string {
		return this.address;
	}
	
	async getSigner(): Promise<mid.MailerIdSigner> {
		if (!this.isProvisionedAndValid()) {
			await this.provisionUsingSavedKey();
		}
		return this.signer;
	}
	
	isProvisionedAndValid(): boolean {
		if (!this.signer) { return false; }
		if (this.signer.certExpiresAt >=
				(Date.now()/1000 + MIN_SECS_LEFT_ASSUMED_OK)) {
			return true;
		} else {
			this.signer = (undefined as any);
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
		setAddress: bind(m, m.setAddress),
		setLoginKeys: bind(m, m.setLoginKeys)
	};
	Object.freeze(managerWrap);
	return managerWrap;
}

Object.freeze(exports);