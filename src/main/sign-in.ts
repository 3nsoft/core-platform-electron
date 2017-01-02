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
	
	private midProvCompletion: CompleteProvisioning|undefined = undefined;
	private address: string = (undefined as any);
	
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
		this.uiSide.addHandler(uiReqNames.startLoginToRemoteStorage,
			bind(this, this.handleStartLoginToRemote));
		this.uiSide.addHandler(uiReqNames.completeLoginAndLocalSetup,
			bind(this, this.handleLoginAndSetupCompletion));
		this.uiSide.addHandler(uiReqNames.useExistingStorage,
			bind(this, this.handleUseExistingStorage));
		this.uiSide.addHandler(uiReqNames.getUsersOnDisk,
			bind(this, this.handleGetUsersOnDisk));
	}
	
	private handleGetUsersOnDisk(env: RequestEnvelope<void>):
			Promise<string[]> {
		return getUsersOnDisk();
	}
	
	private async handleStartLoginToRemote(env: RequestEnvelope<string>):
			Promise<boolean> {
		this.address = env.req;
		let completion = await this.idManager.provisionNew(this.address);
		if (completion) {
			this.midProvCompletion = completion;
		}
		return !!completion;
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

	private async completeLogin(env: RequestEnvelope<string>, pass: string,
			progressStart: number, progressEnd: number): Promise<boolean> {
		let progressCB = this.makeKeyGenProgressCB(env,
			progressStart, progressEnd);
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
		this.midProvCompletion = undefined;
		return passOK;
	}

	private async setupStorageFromRemote(env: RequestEnvelope<string>,
			pass: string, progressStart: number, progressEnd: number):
			Promise<boolean> {
		let progressCB = this.makeKeyGenProgressCB(env,
			progressStart, progressEnd);
		let masterCrypt = async (derivParams: ScryptGenParams) => {
			let skey = await deriveStorageSKey(this.cryptor,
				pass, derivParams, progressCB);
			let decr = sbox.formatWN.makeDecryptor(skey);
			let encr = sbox.formatWN.makeEncryptor(
				skey, random(sbox.NONCE_LENGTH));
			arrays.wipe(skey);
			return {
				decr: decr,
				encr: encr
			}
		};
		let storageOpened = await this.initStorageFromRemote(masterCrypt);
		if (!storageOpened) { return false; }
		await this.initCore(undefined);
		// note that initCore closes this, making it the last call
		return true;
	}
	
	private async handleLoginAndSetupCompletion(env: RequestEnvelope<string>):
			Promise<boolean> {
		let pass = env.req;
		let passOK = await this.completeLogin(env, pass, 0, 50);
		if (!passOK) { return false; }
		await this.setupStorageFromRemote(env, pass, 51, 100);
		return true;
	}
	
	private async handleUseExistingStorage(
			env: RequestEnvelope<signIn.SetupStoreRequest>):
			Promise<boolean> {
		let pass = env.req.pass;
		let user = env.req.user;
		let progressCB = this.makeKeyGenProgressCB(env, 0, 100);
		let masterCrypt = async (derivParams: ScryptGenParams) => {
			let skey = await deriveStorageSKey(this.cryptor,
				pass, derivParams, progressCB);
			let decr = sbox.formatWN.makeDecryptor(skey);
			let encr = sbox.formatWN.makeEncryptor(
				skey, random(sbox.NONCE_LENGTH));
			arrays.wipe(skey);
			return {
				decr: decr,
				encr: encr
			}
		};
		let storageOpened = await this.initExistingStorage(user, masterCrypt);
		if (!storageOpened) { return false; }
		await this.initCore(user);
		// note that initCore closes this, making it the last call
		return true;
	}
	
	/**
	 * This detaches duplex and drops all functions that initialize core.
	 */
	close(): void {
		this.uiSide.close();
		this.initCore = (undefined as any);
		this.initExistingStorage = (undefined as any);
		this.initStorageFromRemote = (undefined as any);
		this.idManager  = (undefined as any);
	}
	
}
	
Object.freeze(exports);