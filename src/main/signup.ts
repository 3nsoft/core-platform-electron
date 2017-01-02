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

import { Duplex, RequestEnvelope }
	from '../lib-common/ipc/electron-ipc';
import { checkAvailableAddressesForName, addUser }
	from '../lib-client/3nweb-signup';
import { IdManager } from './id-manager';
let Uri = require('jsuri');
import { use as keyUse, JsonKey, keyToJson } from '../lib-common/jwkeys';
import { base64 } from '../lib-common/buffer-utils';
import { bind } from '../lib-common/binding';
import { areAddressesEqual } from '../lib-common/canonical-address';
import * as keyDeriv from '../lib-client/key-derivation';
import { IGenerateCrypt, IGetSigner, signUp as common }
	from '../renderer/common';
import { getUsersOnDisk } from '../lib-client/local-files/app-files';
import * as random from '../lib-client/random-node';
import { Cryptor } from '../lib-client/cryptor/cryptor';
import { secret_box as sbox, box, arrays } from 'ecma-nacl';

export interface ScryptGenParams {
	logN: number;
	r: number;
	p: number;
	salt: string;
}

export interface MidParams {
	defaultPKey: {
		pkey: JsonKey;
		params: ScryptGenParams;
	};
	otherPKeys: JsonKey[];
}

export interface StoreParams {
	params: ScryptGenParams;
}

/**
 * With these parameters scrypt shall use memory around:
 * (2^7)*r*N === (2^7)*(2^3)*(2^17) === 2^27 === (2^7)*(2^20) === 128MB
 */
let defaultDerivParams = {
	logN: 17,
	r: 3,
	p: 1
};
Object.freeze(defaultDerivParams);

let SALT_LEN = 32;
let KEY_ID_LEN = 10;

function makeLabeledMidLoginKey(): { skey: JsonKey; pkey: JsonKey } {
	let sk = random.bytes(sbox.KEY_LENGTH);
	let skey = keyToJson({
		k: sk,
		alg: box.JWK_ALG_NAME,
		use: keyUse.MID_PKLOGIN,
		kid: random.stringOfB64Chars(KEY_ID_LEN)
	});
	let pkey = keyToJson({
		k: box.generate_pubkey(sk),
		alg: skey.alg,
		use: skey.use,
		kid: skey.kid
	});
	arrays.wipe(sk);
	return { skey, pkey };
}

export class SignUp {
	
	private mid: {
		defaultSKey: Uint8Array;
		labeledSKey: JsonKey;
		params: MidParams;
	} = (undefined as any);
	private store: {
		skey: Uint8Array;
		params: StoreParams;
	} = (undefined as any);
	private serviceURL: string;
	
	constructor(serviceURL: string,
			private uiSide: Duplex,
			private cryptor: Cryptor,
			private idManager: IdManager,
			private initStorageFromRemote:
				(generateMasterCrypt: IGenerateCrypt) => Promise<boolean>,
			private initCore: () => Promise<void>) {
		this.setServiceURL(serviceURL);
		this.attachHandlersToUI();
		Object.seal(this);
	}
	
	private setServiceURL(serviceURL: string): void {
		let uri = new Uri(serviceURL);
		if (uri.protocol() !== 'https') {
			throw new Error("Url protocol must be https.");
		}
		this.serviceURL = uri.toString();
		if (this.serviceURL.charAt(this.serviceURL.length-1) !== '/') {
			this.serviceURL += '/';
		}
	}
	
	private attachHandlersToUI(): void {
		let uiReqNames = common.reqNames;
		this.uiSide.addHandler(uiReqNames.getAddressesForName,
			bind(this, this.handleGetAvailableAddresses));
		this.uiSide.addHandler(uiReqNames.createUserParams,
			bind(this, this.handleCreateUserParams));
		this.uiSide.addHandler(uiReqNames.addUser,
			bind(this, this.handleAddUser));
		
	}
	
	private async handleGetAvailableAddresses(env: RequestEnvelope<string>):
			Promise<string[]> {
		let addresses = await checkAvailableAddressesForName(
			this.serviceURL, env.req);
		return addresses;
	}
	
	private makeKeyGenProgressCB(env: RequestEnvelope<any>,
			progressStart: number, progressEnd: number) {
		if (progressStart >= progressEnd) { throw new Error(`Invalid progress parameters: start=${progressStart}, end=${progressEnd}.`); }
		let currentProgress = 0;
		let totalProgress = progressStart;
		let progressRange = progressEnd - progressStart;
		return (p: number): void => {
			if (currentProgress >= p) { return; }
			currentProgress = p;
			let newProgress = Math.floor(p/100*progressRange + progressStart);
			if (totalProgress >= newProgress) { return; }
			totalProgress = newProgress;
			this.uiSide.notifyOfProgressOnRequest(env, totalProgress);
		};
	}

	private async genMidParams(env: RequestEnvelope<string>,
			progressStart: number, progressEnd: number) {
		let derivParams: keyDeriv.ScryptGenParams = {
			logN: defaultDerivParams.logN,
			r: defaultDerivParams.r,
			p: defaultDerivParams.p,
			salt: base64.pack(random.bytes(SALT_LEN))
		}
		let progressCB = this.makeKeyGenProgressCB(env,
			progressStart, progressEnd);
		let pass = env.req;
		let defaultPair = await keyDeriv.deriveMidKeyPair(this.cryptor,
			pass, derivParams, progressCB, keyUse.MID_PKLOGIN, '_');
		let labeledKey = makeLabeledMidLoginKey();
		this.mid = {
			defaultSKey: defaultPair.skey,
			labeledSKey: labeledKey.skey,
			params: {
				defaultPKey: {
					pkey: defaultPair.pkey,
					params: derivParams
				},
				otherPKeys: [ labeledKey.pkey ]
			}
		};
	}

	private async genStorageParams(env: RequestEnvelope<string>,
			progressStart: number, progressEnd: number) {
		let derivParams: keyDeriv.ScryptGenParams = {
			logN: defaultDerivParams.logN,
			r: defaultDerivParams.r,
			p: defaultDerivParams.p,
			salt: base64.pack(random.bytes(SALT_LEN))
		};
		let progressCB = this.makeKeyGenProgressCB(env,
			progressStart, progressEnd);
		let pass = env.req;
		let skey = await keyDeriv.deriveStorageSKey(this.cryptor,
			pass, derivParams, progressCB);
		this.store = {
			skey: skey,
			params: {
				params: derivParams
			}
		};
	}
	
	private async handleCreateUserParams(env: RequestEnvelope<string>):
			Promise<void> {
		await this.genMidParams(env, 0, 50);
		await this.genStorageParams(env, 51, 100);
	}
	
	private async initIdManager(address: string): Promise<void> {
		// provision signer with a default key
		let completion = await this.idManager.provisionNew(address);
		await completion.complete(this.mid.defaultSKey);
		// give id manager generated non-default key for other logins
		this.idManager.setLoginKeys([ this.mid.labeledSKey ]);
	}
	
	private initStorage(): Promise<any> {
		let masterCrypt = (derivParams: keyDeriv.ScryptGenParams) => {
			let encr = sbox.formatWN.makeEncryptor(
				this.store.skey, random.bytes(sbox.NONCE_LENGTH));
			let decr = sbox.formatWN.makeDecryptor(this.store.skey);
			arrays.wipe(this.store.skey);
			return Promise.resolve({
				decr: decr,
				encr: encr
			});
		};
		return this.initStorageFromRemote(masterCrypt);
	}
	
	private async handleAddUser(env: RequestEnvelope<string>): Promise<boolean> {
		let address = env.req;
		for (let user of await getUsersOnDisk()) {
			if (areAddressesEqual(address, user)) { throw new Error(
				`Account ${user} already exists on a disk.`); }
		}
		let accountCreated = await addUser(this.serviceURL, {
			userId: address,
			mailerId: this.mid.params,
			storage: this.store.params
		})
		if (!accountCreated) { return false; }
		await this.initIdManager(address);
		await this.initStorage();
		await this.initCore();
		// note that initCore schedules to close this, making it the last call
		return true;
	}
	
	/**
	 * This detaches duplex and drops all functions that initialize core.
	 */
	close(): void {
		this.uiSide.close();
		this.initCore = (undefined as any);
		this.initStorageFromRemote = (undefined as any);
		this.idManager = (undefined as any);
	}
	
}

Object.freeze(exports);