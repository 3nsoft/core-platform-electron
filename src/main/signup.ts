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

import { checkAvailableAddressesForName, addUser }
	from '../lib-client/3nweb-signup';
import { makeNetClient, NetClient } from '../lib-client/electron/net';
import { IdManager } from './id-manager';
import { parse as parseUrl } from 'url';
import { use as keyUse, JsonKey, keyToJson } from '../lib-common/jwkeys';
import { base64 } from '../lib-common/buffer-utils';
import { bind } from '../lib-common/binding';
import { areAddressesEqual } from '../lib-common/canonical-address';
import * as keyDeriv from '../lib-client/key-derivation';
import { getUsersOnDisk } from '../lib-client/local-files/app-files';
import * as random from '../lib-common/random-node';
import { Cryptor } from '../lib-client/cryptor/cryptor';
import { secret_box as sbox, box, arrays } from 'ecma-nacl';
import { GenerateKey, makeKeyGenProgressCB } from './sign-in';
import { Subject } from 'rxjs';
import { logError } from '../lib-client/logging/log-to-file';

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
const defaultDerivParams = {
	logN: 17,
	r: 3,
	p: 1
};
Object.freeze(defaultDerivParams);

const SALT_LEN = 32;
const KEY_ID_LEN = 10;

function makeLabeledMidLoginKey(): { skey: JsonKey; pkey: JsonKey } {
	const sk = random.bytesSync(sbox.KEY_LENGTH);
	const skey = keyToJson({
		k: sk,
		alg: box.JWK_ALG_NAME,
		use: keyUse.MID_PKLOGIN,
		kid: random.stringOfB64CharsSync(KEY_ID_LEN)
	});
	const pkey = keyToJson({
		k: box.generate_pubkey(sk),
		alg: skey.alg,
		use: skey.use,
		kid: skey.kid
	});
	arrays.wipe(sk);
	return { skey, pkey };
}

type SignUpService = web3n.startup.SignUpService;

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

	private netLazyInit: NetClient|undefined = undefined;
	private get net(): NetClient {
		if (!this.netLazyInit) {
			this.netLazyInit = makeNetClient();
		}
		return this.netLazyInit;
	}
	
	constructor(serviceURL: string,
			private cryptor: Cryptor,
			private idManager: IdManager,
			private initStorageFromRemote:
				(generateKey: GenerateKey) => Promise<boolean>) {
		this.setServiceURL(serviceURL);
		Object.seal(this);
	}
	
	private setServiceURL(serviceURL: string): void {
		const url = parseUrl(serviceURL);
		if (url.protocol !== 'https:') {
			throw new Error("Url protocol must be https.");
		}
		this.serviceURL = serviceURL;
		if (!this.serviceURL.endsWith('/')) {
			this.serviceURL += '/';
		}
	}

	wrap(): SignUpService {
		const service: SignUpService = {
			addUser: bind(this, this.addUser),
			createUserParams: bind(this, this.createUserParams),
			getAvailableAddresses: bind(this, this.getAvailableAddresses),
			isActivated: async () => { throw new Error(`Not implemented, yet`); }
		};
		return Object.freeze(service);
	}
	
	private async getAvailableAddresses(name: string): Promise<string[]> {
		const addresses = await checkAvailableAddressesForName(
			this.net, this.serviceURL, name);
		return addresses;
	}
	
	private async createUserParams(pass: string,
			progressCB: (progress: number) => void): Promise<void> {
		await this.genMidParams(pass, 0, 50, progressCB);
		await this.genStorageParams(pass, 51, 100, progressCB);
	}

	private async genStorageParams(pass: string,
			progressStart: number, progressEnd: number,
			originalProgressCB: (progress: number) => void): Promise<void> {
		const derivParams: keyDeriv.ScryptGenParams = {
			logN: defaultDerivParams.logN,
			r: defaultDerivParams.r,
			p: defaultDerivParams.p,
			salt: base64.pack(await random.bytes(SALT_LEN))
		};
		const progressCB = makeKeyGenProgressCB(
			progressStart, progressEnd, originalProgressCB);
		const skey = await keyDeriv.deriveStorageSKey(this.cryptor,
			pass, derivParams, progressCB);
		this.store = {
			skey: skey,
			params: {
				params: derivParams
			}
		};
	}

	private async genMidParams(pass: string,
			progressStart: number, progressEnd: number,
			originalProgressCB: (progress: number) => void): Promise<void> {
		const derivParams: keyDeriv.ScryptGenParams = {
			logN: defaultDerivParams.logN,
			r: defaultDerivParams.r,
			p: defaultDerivParams.p,
			salt: base64.pack(await random.bytes(SALT_LEN))
		}
		const progressCB = makeKeyGenProgressCB(
			progressStart, progressEnd, originalProgressCB);
		const defaultPair = await keyDeriv.deriveMidKeyPair(this.cryptor,
			pass, derivParams, progressCB, keyUse.MID_PKLOGIN, '_');
		const labeledKey = makeLabeledMidLoginKey();
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
	
	private async initIdManager(address: string): Promise<void> {
		// provision signer with a default key
		const completion = await this.idManager.provisionNew(address);
		if (!completion) { throw new Error(
			`Failed to start provisioning MailerId identity`); }
		await completion.complete(this.mid.defaultSKey);
		// give id manager generated non-default key for other logins
		this.idManager.setLoginKeys([ this.mid.labeledSKey ]);
	}
	
	private initStorage(): Promise<any> {
		const masterCrypt = async (derivParams: keyDeriv.ScryptGenParams) => {
			const key = this.store.skey;
			this.store.skey = (undefined as any);
			return key;
		};
		return this.initStorageFromRemote(masterCrypt);
	}
	
	private async addUser(address: string): Promise<boolean> {
		for (const user of await getUsersOnDisk()) {
			if (areAddressesEqual(address, user)) { throw new Error(
				`Account ${user} already exists on a disk.`); }
		}
		try {
			const accountCreated = await addUser(this.net, this.serviceURL, {
				userId: address,
				mailerId: this.mid.params,
				storage: this.store.params
			});
			if (!accountCreated) { return false; }
			await this.initIdManager(address);
			await this.initStorage();
			this.doneBroadcast.next();
			return true;
		} catch (err) {
			await logError(err);
			throw err;
		}
	}

	private doneBroadcast = new Subject<undefined>();

	done$ = this.doneBroadcast.asObservable();
	
}
Object.freeze(SignUp.prototype);
Object.freeze(SignUp);

Object.freeze(exports);