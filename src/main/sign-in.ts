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

import { CompleteProvisioning, IdManager } from './id-manager';
import { ScryptGenParams, deriveMidKeyPair, deriveStorageSKey }
	from '../lib-client/key-derivation';
import { secret_box as sbox, arrays } from 'ecma-nacl';
import { bind } from '../lib-common/binding';
import { getUsersOnDisk } from '../lib-client/local-files/app-files';
import { Cryptor } from '../lib-client/cryptor/cryptor';
import { Subject } from 'rxjs';
import { logError } from '../lib-client/logging/log-to-file';
import { errWithCause } from '../lib-common/exceptions/error';

export type GenerateKey  =
	(derivParams: ScryptGenParams) => Promise<Uint8Array>;

type SignInService = web3n.startup.SignInService;

export class SignIn {
	
	private midProvCompletion: CompleteProvisioning|undefined = undefined;
	private address: string = (undefined as any);
	
	constructor(
			private cryptor: Cryptor,
			private idManager: IdManager,
			private initStorageFromRemote:
				(generateMasterCrypt: GenerateKey) => Promise<boolean>,
			private initExistingStorage: (user: string,
				generateMasterCrypt: GenerateKey) => Promise<boolean>) {
		Object.seal(this);
	}

	wrap(): SignInService {
		const service: SignInService = {
			completeLoginAndLocalSetup:
				bind(this, this.completeLoginAndLocalSetup),
			getUsersOnDisk,
			startLoginToRemoteStorage: bind(this, this.startLoginToRemoteStorage),
			useExistingStorage: bind(this, this.useExistingStorage)
		};
		return Object.freeze(service);
	}
	
	private async startLoginToRemoteStorage(address: string): Promise<boolean> {
		try {
			this.address = address;
			const completion = await this.idManager.provisionNew(this.address);
			if (completion) {
				this.midProvCompletion = completion;
			}
			return !!completion;
		} catch(err) {
			await log(err, 'Failing to start login in a state without cache');
			throw err;
		}
	}
	
	private async completeLoginAndLocalSetup(pass: string,
			progressCB: (progress: number) => void): Promise<boolean> {
		try {
			const passOK = await this.completeLogin(pass, 0, 50, progressCB);
			if (!passOK) { return false; }
			await this.setupStorageFromRemote(pass, 51, 100, progressCB);
			return true;
		} catch(err) {
			await log(err, 'Failing to complete login in a state without cache');
			throw err;
		}
	}

	private async completeLogin(pass: string,
			progressStart: number, progressEnd: number,
			originalProgressCB: (progress: number) => void): Promise<boolean> {
		const progressCB = makeKeyGenProgressCB(
			progressStart, progressEnd, originalProgressCB);
		let passOK: boolean;
		if (this.midProvCompletion) {
			const skey = (await deriveMidKeyPair(this.cryptor,
				pass, this.midProvCompletion.keyParams, progressCB)).skey;
			passOK = await this.midProvCompletion.complete(skey);
		} else {
			this.midProvCompletion = await
				this.idManager.provisionNew(this.address);
			if (!this.midProvCompletion) { throw new Error(
				`Failed to start provisioning MailerId identity`); }
			const skey = (await deriveMidKeyPair(this.cryptor,
				pass, this.midProvCompletion.keyParams, progressCB)).skey
			passOK = await this.midProvCompletion.complete(skey);
		}
		this.midProvCompletion = undefined;
		return passOK;
	}

	private async setupStorageFromRemote(pass: string,
			progressStart: number, progressEnd: number,
			originalProgressCB: (progress: number) => void): Promise<boolean> {
		const progressCB = makeKeyGenProgressCB(
			progressStart, progressEnd, originalProgressCB);
		const masterCrypt = (derivParams: ScryptGenParams) =>
			deriveStorageSKey(this.cryptor, pass, derivParams, progressCB);
		const storageOpened = await this.initStorageFromRemote(masterCrypt);
		if (!storageOpened) { return false; }
		this.doneBroadcast.next(undefined);
		return true;
	}

	private doneBroadcast = new Subject<undefined>();

	done$ = this.doneBroadcast.asObservable();
	
	private async useExistingStorage(user: string, pass: string,
			originalProgressCB: (progress: number) => void): Promise<boolean> {
		try {
			const progressCB = makeKeyGenProgressCB(0, 100, originalProgressCB);
			const masterCrypt = (derivParams: ScryptGenParams) =>
				deriveStorageSKey(this.cryptor, pass, derivParams, progressCB);
			this.idManager.setAddress(user);
			const storageOpened = await this.initExistingStorage(
				this.idManager.getId(), masterCrypt);
			if (!storageOpened) { return false; }
			this.doneBroadcast.next();
			return true;
		} catch(err) {
			await log(err, 'Failing to start in a state with cache');
			throw err;
		}
	}
	
}
Object.freeze(SignIn.prototype);
Object.freeze(SignIn);
	
export function makeKeyGenProgressCB(progressStart: number, progressEnd: number,
		progressCB: (progress: number) => void) {
	if (progressStart >= progressEnd) { throw new Error(`Invalid progress parameters: start=${progressStart}, end=${progressEnd}.`); }
	let currentProgress = 0;
	let totalProgress = progressStart;
	const progressRange = progressEnd - progressStart;
	return (p: number): void => {
		if (currentProgress >= p) { return; }
		currentProgress = p;
		const newProgress = Math.floor(p/100*progressRange + progressStart);
		if (totalProgress >= newProgress) { return; }
		totalProgress = newProgress;
		progressCB(totalProgress)
	};
}

async function log(err: any, msg: string): Promise<void> {
	await logError(errWithCause(err, msg));
}

Object.freeze(exports);