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

/**
 * This defines a base class for some service's client that logs in with
 * Public Key Login process and uses respectively authenticated session.
 */

import { doJsonRequest, doBinaryRequest, doBodylessRequest, makeException }
	from './xhr-utils';
import { HTTPException } from '../lib-common/exceptions/http';
import { base64 } from '../lib-common/buffer-utils';
import { secret_box as sbox, box, nonce as nMod, arrays, compareVectors }
	from 'ecma-nacl';
import { SessionEncryptor, makeSessionEncryptor }
	from '../lib-common/session-encryptor';
import * as loginApi from '../lib-common/service-api/pub-key-login';
let Uri = require('jsuri');

export interface ICalcDHSharedKey {
	(): Uint8Array;
}

export interface LoginCompletion {
	keyParams: any;
	serverPKey: Uint8Array;
	complete(dhsharedKeyCalc: ICalcDHSharedKey): Promise<void>;
}

export interface PKLoginException extends HTTPException {
	serverNotTrusted: boolean;
	cryptoResponseNotAccepted: boolean;
	unknownUser: boolean;
}

export abstract class ServiceUser {
	
	userId: string;
	sessionId: string = null;
	
	private uri: string;
	get serviceURI(): string {
		return this.uri;
	}
	set serviceURI(uriString: string) {
		let uriObj = new Uri(uriString);
		if (uriObj.protocol() !== 'https') {
			throw new Error("Url protocol must be https.");
		}
		if (!uriObj.host()) {
			throw new Error("Host name is missing.");
		}
		let p: string = uriObj.path();
		if (p[p.length-1] !== '/') {
			uriObj.setPath(p+'/');
		}
		this.uri = uriObj.toString();
	}
	
	private loginUrlPart: string;
	private logoutUrlEnd: string;
	private redirectedFrom: string = null;
	private canBeRedirected: boolean;

	encryptor: SessionEncryptor = null;
	private encChallenge: Uint8Array = null;
	private serverPubKey: Uint8Array = null;
	private serverVerificationBytes: Uint8Array = null;
	private keyDerivationParams: any = null;
	
	constructor(userId: string, opts: {
			login: string; logout: string; canBeRedirected?: boolean; }) {
		this.userId = userId;
		this.loginUrlPart = opts.login;
		if ((this.loginUrlPart.length > 0) &&
				(this.loginUrlPart[this.loginUrlPart.length-1] !== '/')) {
			this.loginUrlPart += '/';
		}
		this.logoutUrlEnd = opts.logout;
		this.canBeRedirected = !!opts.canBeRedirected;
	}
	
	private async startSession(): Promise<void> {
		let reqData: loginApi.start.Request = {
			userId: this.userId
		};
		let rep = await doJsonRequest<loginApi.start.Reply>({
			url: this.serviceURI + this.loginUrlPart + loginApi.start.URL_END,
			method: 'POST',
			responseType: 'json'
		}, reqData);
		if (rep.status == loginApi.start.SC.ok) {
			// set sessionid
			if (!rep.data || (typeof rep.data.sessionId !== 'string')) {
				throw makeException(rep, 'Malformed reply to starting session');
			}
			this.sessionId = rep.data.sessionId;
			// set server public key
			if (typeof rep.data.serverPubKey !== 'string') {
				throw makeException(rep,
					'Malformed reply: serverPubKey string is missing.');
			}
			try {
				this.serverPubKey = base64.open(rep.data.serverPubKey);
				if (this.serverPubKey.length !== box.KEY_LENGTH) {
					throw makeException(rep,
						'Malformed reply: server\'s key has a wrong size.');
				}
			} catch (err) {
				throw makeException(rep,
						'Malformed reply: bad serverPubKey string. Error: '+
						(('string' === typeof err)? err : err.message));
			}
			// get encrypted session key from json body
			if ('string' !== typeof rep.data.sessionKey) {
				throw makeException(rep,
						'Malformed reply: sessionKey string is missing.');
			}
			try {
				this.encChallenge = base64.open(rep.data.sessionKey);
				if (this.encChallenge.length !==
						(sbox.NONCE_LENGTH + sbox.KEY_LENGTH)) {
					throw makeException(rep, 'Malformed reply: '+
						'byte chunk with session key has a wrong size.');
				}
			} catch (err) {
				throw makeException(rep, 'Malformed reply: '+
					"bad sessionKey string. Error: "+
					(('string' === typeof err)? err : err.message));
			}
			// get key derivation parameters
			if ('object' !== typeof rep.data.keyDerivParams) {
				throw makeException(rep, 'Malformed reply: '+
					"keyDerivParams string is missing.");
			}
			this.keyDerivationParams = rep.data.keyDerivParams;
		} else if (this.canBeRedirected &&
				(rep.status === loginApi.start.SC.redirect)) {
			let rd: loginApi.start.RedirectReply = <any> rep.data;
			if (!rd || ('string' !== typeof rd.redirect)) {
				throw makeException(rep, 'Malformed reply');
			}
			// refuse second redirect
			if (this.redirectedFrom !== null) {
				throw makeException(rep,
					"Redirected too many times. First redirect "+
					"was from "+this.redirectedFrom+" to "+
					this.serviceURI+". Second and forbidden "+
					"redirect is to "+rd.redirect);
			}
			// set params
			this.redirectedFrom = this.serviceURI;
			this.serviceURI = rd.redirect;
			// start redirect call
			return this.startSession();
		} else if (rep.status === loginApi.start.SC.unknownUser) {
			let exc = <PKLoginException> makeException(rep);
			exc.unknownUser = true;
			throw exc;
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	private openSessionKey(dhsharedKeyCalc: ICalcDHSharedKey): void {
		let dhsharedKey = dhsharedKeyCalc();
		let nonce = new Uint8Array(
			this.encChallenge.subarray(0, sbox.NONCE_LENGTH));
		let sessionKey = new Uint8Array(
			this.encChallenge.subarray(sbox.NONCE_LENGTH));
		// encrypted challenge has session key packaged into WN format, with
		// poly part cut out. Therefore, usual open method will not do as it
		// does poly check. We should recall that cipher is a stream with data
		// xor-ed into it. Encrypting zeros gives us stream bytes, which can
		// be xor-ed into the data part of challenge bytes to produce a key.
		let zeros = new Uint8Array(sbox.KEY_LENGTH);
		let streamBytes = sbox.pack(zeros, nonce, dhsharedKey);
		streamBytes = streamBytes.subarray(streamBytes.length - sbox.KEY_LENGTH);
		for (let i=0; i < sbox.KEY_LENGTH; i+=1) {
			sessionKey[i] ^= streamBytes[i];
		}
		// since there was no poly, we are not sure, if we are talking to server
		// that knows our public key. Server shall give us these bytes, and we
		// should prepare ours for comparison.
		this.serverVerificationBytes = sbox.pack(sessionKey, nonce, dhsharedKey);
		this.serverVerificationBytes =
			this.serverVerificationBytes.subarray(0, sbox.POLY_LENGTH);
		nMod.advanceOddly(nonce);
		this.encryptor = makeSessionEncryptor(sessionKey, nonce);
		// encrypt session key for completion of login exchange
		this.encChallenge = this.encryptor.pack(sessionKey);
		// cleanup arrays
		arrays.wipe(dhsharedKey, nonce, sessionKey);
	}
	
	private async completeLoginExchange(): Promise<void> {
		let rep = await doBinaryRequest<Uint8Array>({
			url: this.serviceURI + this.loginUrlPart + loginApi.complete.URL_END,
			method: 'POST',
			sessionId: this.sessionId,
			responseType: 'arraybuffer'
		}, this.encChallenge);
		this.encChallenge = null;
		if (rep.status === loginApi.complete.SC.ok) {
			// compare bytes to check, if server can be trusted
			if (compareVectors(
					rep.data, this.serverVerificationBytes)) {
				this.serverVerificationBytes = null;
			} else {
				let exc = <PKLoginException> makeException(rep);
				exc.serverNotTrusted = true;
				throw exc;
			}
		} else if (rep.status === loginApi.complete.SC.authFailed) {
				let exc = <PKLoginException> makeException(rep);
				exc.cryptoResponseNotAccepted = true;
				throw exc;
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	/**
	 * This method starts login as a two-step process.
	 * In particular, it does a first call, that does not need keys, producing
	 * a function, that will take shared key calculator, and will complete
	 * second phase of the login.
	 * @return a promise, resolvable to an object with function, that performs
	 * second and last phase of the login. 
	 */
	async login(): Promise<LoginCompletion> {
		await this.startSession();
		let thisPKL = this;
		async function complete(dhsharedKeyCalc: ICalcDHSharedKey) {
			thisPKL.openSessionKey(dhsharedKeyCalc)
			await thisPKL.completeLoginExchange();
		};
		return {
			keyParams: this.keyDerivationParams,
			serverPKey: this.serverPubKey,
			complete: complete
		};
	}
	
	/**
	 * This method closes current session.
	 * @return a promise for request completion.
	 */
	async logout(): Promise<void> {
		let rep = await doBodylessRequest<void>({
			url: this.serviceURI + this.logoutUrlEnd,
			method: 'POST',
			sessionId: this.sessionId
		})
		if (rep.status !== 200) {
			throw makeException(rep, 'Unexpected status');
		}
		this.sessionId = null;
		this.encryptor.destroy();
		this.encryptor = null;
	}
	
}

Object.freeze(exports);