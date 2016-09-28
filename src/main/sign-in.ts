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
import { IGetSigner, IGenerateCrypt, signIn } from '../renderer/common';
import { CompleteProvisioning, IdManager } from './id-manager';
import { ScryptGenParams, deriveMidKeyPair, deriveStorageSKey }
	from '../lib-client/key-derivation';
import { bytes as random } from '../lib-client/random-node';
import { secret_box as sbox, arrays } from 'ecma-nacl';
import { bind } from '../lib-common/binding';
import { getUsersOnDisk } from '../lib-client/local-files/app-files';
import { Cryptor } from '../lib-client/cryptor/cryptor';

export class SignIn {
	
	private isIdentitySet = false;
	private midProvCompletion: CompleteProvisioning = null;
	private address: string = null;
	
	constructor(
			private uiSide: Duplex,
			private cryptor: Cryptor,
			private idManager: IdManager,
			private initStorageFromRemote:
				(generateMasterCrypt: IGenerateCrypt) => Promise<boolean>,
			private initExistingStorage: (user: string,
				generateMasterCrypt: IGenerateCrypt) => Promise<boolean>,
			private initCore: (user?: string) => Promise<void>) {
		this.attachHandlersToUI();
		Object.seal(this);
	}
	
	private attachHandlersToUI(): void {
		let uiReqNames = signIn.reqNames;
		this.uiSide.addHandler(uiReqNames.startMidProv,
			bind(this, this.handleMidProvStart));
		this.uiSide.addHandler(uiReqNames.completeMidProv,
			bind(this, this.handleMidProvCompletion));
		this.uiSide.addHandler(uiReqNames.setupStorage,
			bind(this, this.handleSetupStorage));
		this.uiSide.addHandler(uiReqNames.getUsersOnDisk,
			bind(this, this.handleGetUsersOnDisk));
	}
	
	private handleGetUsersOnDisk(env: RequestEnvelope<void>):
			Promise<string[]> {
		return getUsersOnDisk();
	}
	
	private async handleMidProvStart(env: RequestEnvelope<string>):
			Promise<boolean> {
		this.address = env.req;
		this.isIdentitySet = false;
		let completion = await this.idManager.provisionNew(this.address);
		if (completion) {
			this.midProvCompletion = completion;
		}
		return !!completion;
	}
	
	private makeKeyGenProgressCB(env: RequestEnvelope<any>):
			(p: number) => void {
		let progress = 0;
		return (p: number): void => {
			p = Math.floor(p);
			if (progress >= p) { return; }
			progress = p;
			this.uiSide.notifyOfProgressOnRequest(env, progress);
		};
	}
	
	private async handleMidProvCompletion(env: RequestEnvelope<string>):
			Promise<boolean> {
		let pass = env.req;
		let progressCB = this.makeKeyGenProgressCB(env);
		
		let passOK: boolean;
		if (this.midProvCompletion) {
			let skey = (await deriveMidKeyPair(this.cryptor,
				pass, this.midProvCompletion.keyParams, progressCB)).skey;
			passOK = await this.midProvCompletion.complete(skey);
		} else {
			this.midProvCompletion = await
				this.idManager.provisionNew(this.address);
			let skey = (await deriveMidKeyPair(this.cryptor,
				pass, this.midProvCompletion.keyParams, progressCB)).skey
			passOK = await this.midProvCompletion.complete(skey);
		}
		this.midProvCompletion = null;
		if (passOK) {
			this.isIdentitySet = true;
		}
		return passOK;
	}
	
	private async handleSetupStorage(
			env: RequestEnvelope<signIn.SetupStoreRequest>):
			Promise<boolean> {
		let pass = env.req.pass;
		let user = env.req.user;
		let thee = this;
		async function masterCrypt(derivParams: ScryptGenParams) {
			let skey = await deriveStorageSKey(thee.cryptor,
				pass, derivParams, thee.makeKeyGenProgressCB(env));
			let decr = sbox.formatWN.makeDecryptor(skey);
			let encr = sbox.formatWN.makeEncryptor(
				skey, random(sbox.NONCE_LENGTH));
			arrays.wipe(skey);
			return {
				decr: decr,
				encr: encr
			}
		};
		let storageOpened = await (this.isIdentitySet ?
			this.initStorageFromRemote(masterCrypt) :
			this.initExistingStorage(user, masterCrypt));
		if (!storageOpened) { return false; }
		await this.initCore(this.isIdentitySet ? undefined : user);
		// note that initCore closes this, making it the last call
		return true;
	}
	
	/**
	 * This detaches duplex and drops all functions that initialize core.
	 */
	close(): void {
		this.uiSide.close();
		this.initCore = null;
		this.initExistingStorage = null;
		this.initStorageFromRemote = null;
		this.idManager  = null;
	}
	
}
	
Object.freeze(exports);