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
import * as jwk from '../lib-common/jwkeys';
import { base64 } from '../lib-common/buffer-utils';
import { bind } from '../lib-common/binding';
import { areAddressesEqual } from '../lib-common/canonical-address';
import * as keyDeriv from '../lib-client/key-derivation';
import { IGenerateCrypt, IGetSigner, signUp as common }
	from '../renderer/common';
import { getUsersOnDisk } from '../lib-client/local-files/app-files';
import * as random from '../lib-client/random-node';
import { Cryptor } from '../lib-client/cryptor/cryptor';
import { secret_box as sbox, arrays } from 'ecma-nacl';

export interface ScryptGenParams {
	logN: number;
	r: number;
	p: number;
	salt: string;
}

export interface MidParams {
	pkey: jwk.JsonKey;
	params: ScryptGenParams;
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

export class SignUp {
	
	private mid: {
		skey: Uint8Array;
		params: MidParams;
	} = null;
	private store: {
		skey: Uint8Array;
		params: StoreParams;
	} = null;
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
		this.uiSide.addHandler(uiReqNames.createMidParams,
			bind(this, this.handleCreateMidParams));
		this.uiSide.addHandler(uiReqNames.createStorageParams,
			bind(this, this.handleCreateStorageParams));
		this.uiSide.addHandler(uiReqNames.addUser,
			bind(this, this.handleAddUser));
		
	}
	
	private async handleGetAvailableAddresses(env: RequestEnvelope<string>):
			Promise<string[]> {
		let addresses = await checkAvailableAddressesForName(
			this.serviceURL, env.req);
		return addresses;
	}
	
	private makeKeyGenProgressCB(env: RequestEnvelope<any>) {
		let progress = 0;
		return (p: number): void => {
			p = Math.floor(p);
			if (progress >= p) { return; }
			progress = p;
			this.uiSide.notifyOfProgressOnRequest(env, progress);
		};
	}
	
	private async handleCreateMidParams(env: RequestEnvelope<string>):
			Promise<void> {
		let derivParams: keyDeriv.ScryptGenParams = {
			logN: defaultDerivParams.logN,
			r: defaultDerivParams.r,
			p: defaultDerivParams.p,
			salt: base64.pack(random.bytes(SALT_LEN))
		}
		let progressCB = this.makeKeyGenProgressCB(env);
		let pass = env.req;
		let kid = base64.pack(random.bytes(KEY_ID_LEN));
		let pair = await keyDeriv.deriveMidKeyPair(this.cryptor,
			pass, derivParams, progressCB, jwk.use.MID_PKLOGIN, kid);
		this.mid = {
			skey: pair.skey,
			params: {
				pkey: pair.pkey,
				params: derivParams
			}
		};
	}
	
	private async handleCreateStorageParams(env: RequestEnvelope<string>):
			Promise<void> {
		let derivParams: keyDeriv.ScryptGenParams = {
			logN: defaultDerivParams.logN,
			r: defaultDerivParams.r,
			p: defaultDerivParams.p,
			salt: base64.pack(random.bytes(SALT_LEN))
		};
		let progressCB = this.makeKeyGenProgressCB(env);
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
	
	private async initIdManager(address: string): Promise<void> {
		let completion = await this.idManager.provisionNew(address)
		await completion.complete(this.mid.skey);
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
	
	private async handleAddUser(env: RequestEnvelope<string>):
			Promise<boolean> {
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
		this.initCore = null;
		this.initStorageFromRemote = null;
		this.idManager = null;
	}
	
}

Object.freeze(exports);