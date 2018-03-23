/*
 Copyright (C) 2015, 2017 3NSoft Inc.
 
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
 * MailerId and uses respectively authenticated session.
 */

import { makeException, makeNetClient, Reply, RequestOpts }
	from '../lib-client/electron/net';
import { HTTPException } from '../lib-common/exceptions/http';
import { user as mid } from '../lib-common/mid-sigs-NaCl-Ed';
import * as api from '../lib-common/service-api/mailer-id/login';
import * as WebSocket from 'ws';
import { openSocket } from './ws-utils';
import { parse as parseUrl } from 'url';

export interface LoginException extends HTTPException {
	loginFailed?: boolean;
	unknownUser?: boolean;
}

export interface IGetMailerIdSigner {
	(): Promise<mid.MailerIdSigner>;
}

export abstract class ServiceUser {
	
	private uri: string = (undefined as any);
	private get serviceURI(): string {
		return this.uri;
	}
	private set serviceURI(uriString: string) {
		const u = parseUrl(uriString);
		if (u.protocol !== 'https:') {
			throw new Error("Url protocol must be https.");
		}
		if (!u.host) {
			throw new Error("Host name is missing.");
		}
		this.uri = `${u.protocol}//${u.host}${u.pathname}`;
		if (!this.uri.endsWith('/')) {
			this.uri += '/';
		}
	}
	private get serviceDomain(): string {
		return parseUrl(this.uri).hostname!;
	}
	
	private loginUrlPart: string;
	private logoutUrlEnd: string;
	private redirectedFrom: string = (undefined as any);
	private canBeRedirected: boolean;

	private sessionId: string = (undefined as any);
	private loginProc: Promise<void> = (undefined as any);

	protected net = makeNetClient();
	
	protected constructor(
		public userId: string,
		opts: { login: string; logout: string; canBeRedirected?: boolean; },
		private getSigner: IGetMailerIdSigner|undefined,
		private getInitServiceURI: () => Promise<string>
	) {
		this.loginUrlPart = opts.login;
		if ((this.loginUrlPart.length > 0)
		&& (this.loginUrlPart[this.loginUrlPart.length-1] !== '/')) {
			this.loginUrlPart += '/';
		}
		this.logoutUrlEnd = opts.logout;
		this.canBeRedirected = !!opts.canBeRedirected;
	}
	
	private get isUriSet(): boolean {
		return (typeof this.serviceURI === 'string');
	}

	private throwOnBadServiceURI(): void {
		if (!this.isUriSet) { throw new Error(
			`Service uri is not a string: ${this.serviceURI}`); }
	}

	/**
	 * This initializes service uri, if it hasn't been set, yet.
	 * Else, this function does nothing.
	 */
	private async initServiceURI(): Promise<void> {
		if (this.isUriSet) { return; }
		this.serviceURI = await this.getInitServiceURI();
		this.getInitServiceURI = undefined as any;
	}
	
	private async startSession(): Promise<string> {
		this.throwOnBadServiceURI();
		const reqData: api.startSession.Request = {
			userId: this.userId
		};
		const rep = await this.net.doJsonRequest<
				api.startSession.Reply|api.startSession.RedirectReply>({
			url: `${this.serviceURI}${this.loginUrlPart}${api.startSession.URL_END}`,
			method: 'POST',
			responseType: 'json'
		}, reqData);
		if (rep.status === api.startSession.SC.ok) {
			const r = <api.startSession.Reply> rep.data;
			if (!r || (typeof r.sessionId !== 'string')) {
				throw makeException(rep,
					'Malformed reply to starting session');
			}
			return r.sessionId;
		} else if ((rep.status === api.startSession.SC.redirect) &&
				this.canBeRedirected) {
			const rd = <api.startSession.RedirectReply> rep.data;
			if (!rd || ('string' !== typeof rd.redirect)) {
				throw makeException(rep,
					'Malformed redirect reply to starting session');
			}
			// refuse second redirect
			if (this.redirectedFrom !== undefined) {
				throw makeException(rep,
					`Redirected too many times. First redirect was from ${this.redirectedFrom} to ${this.serviceURI}. Second and forbidden redirect is to ${rd.redirect}`);
			}
			// set params
			this.redirectedFrom = this.serviceURI;
			this.serviceURI = rd.redirect;
			// start redirect call
			return await this.startSession();
		} else if (rep.status === api.startSession.SC.unknownUser) {
			const exc = <LoginException> makeException(rep);
			exc.unknownUser = true;
			throw exc;
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	private async authenticateSession(sessionId: string,
			midSigner: mid.MailerIdSigner): Promise<void> {
		this.throwOnBadServiceURI();
		const reqData: api.authSession.Request = {
			assertion: midSigner.generateAssertionFor(
				this.serviceDomain, sessionId),
			userCert: midSigner.userCert,
			provCert: midSigner.providerCert
		};
		const rep = await this.net.doJsonRequest<void>({
			url: `${this.serviceURI}${this.loginUrlPart}${api.authSession.URL_END}`,
			method: 'POST',
			sessionId
		}, reqData);
		if (rep.status === api.authSession.SC.ok) {
			return;
		}
		if (rep.status === api.authSession.SC.authFailed) {
			const exc = <LoginException> makeException(rep);
			exc.loginFailed = true;
			throw exc;
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	/**
	 * This starts and authorizes a new session.
	 * @param midSigner is not needed, if signer-getter has been given to
	 * this object at construction time
	 * @return a promise, resolvable, when mailerId login successfully
	 * completes.
	 */
	async login(midSigner?: mid.MailerIdSigner): Promise<void> {
		if (this.sessionId) { return; } 
		if (this.loginProc) { return this.loginProc; }
		this.loginProc = (async () => {
			await this.initServiceURI();
			const sessionId = await this.startSession();
			if (!midSigner) {
				if (!this.getSigner) { throw new Error(`MailerId signer is not given, while signer getter is not set at construction time.`); }
				midSigner = await this.getSigner();
			}
			await this.authenticateSession(sessionId, midSigner);
			this.sessionId = sessionId;
			this.loginProc = (undefined as any);
		})();
		return this.loginProc;
	}
	
	/**
	 * This method closes current session.
	 * @return a promise for request completion.
	 */
	async logout(): Promise<void> {
		if (!this.sessionId) { return; }
		this.throwOnBadServiceURI();
		const rep = await this.net.doBodylessRequest<void>({
			url: `${this.serviceURI}${this.logoutUrlEnd}`,
			method: 'POST',
			sessionId: this.sessionId
		});
		if (rep.status === 200) {
			this.sessionId = (undefined as any);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	private async callEnsuringLogin<T>(func: () => Promise<Reply<T>>):
			Promise<Reply<T>> {
		if (this.loginProc || !this.sessionId) {
			await this.login();
			return func();
		} else {
			// first attepmt
			const initSessionId = this.sessionId;
			const rep = await func();
			if (rep.status !== api.ERR_SC.needAuth) { return rep; }

			// if auth is needed, do login and a second attempt
			if (this.sessionId === initSessionId) {
				this.sessionId = (undefined as any);
			}
			await this.login();
			return func();
		}
	}

	private prepCallOpts(opts: RequestOpts, isWS?: true): void {
		opts.sessionId = this.sessionId;
		if (opts.appPath) {
			opts.url = (isWS ?
				`wss${this.serviceURI.substring(5)}${opts.appPath}` :
				`${this.serviceURI}${opts.appPath}`);
		} else if (!opts.url) { 
			throw new Error(
				`Missing both appPath and ready url in request options.`);
		}
	}
	
	protected doBodylessSessionRequest<T>(opts: RequestOpts): Promise<Reply<T>> {
		return this.callEnsuringLogin<T>(() => {
			this.prepCallOpts(opts);
			return this.net.doBodylessRequest(opts);
		});
	}
	
	protected doJsonSessionRequest<T>(opts: RequestOpts, json: any):
			Promise<Reply<T>> {
		return this.callEnsuringLogin<T>(() => {
			this.prepCallOpts(opts);
			return this.net.doJsonRequest(opts, json);
		});
	}
	
	protected doBinarySessionRequest<T>(opts: RequestOpts,
			bytes: Uint8Array|Uint8Array[]): Promise<Reply<T>> {
		return this.callEnsuringLogin<T>(() => {
			this.prepCallOpts(opts);
			return this.net.doBinaryRequest(opts, bytes);
		});
	}

	protected openWS(appPath: string): Promise<Reply<WebSocket>> {
		const opts: RequestOpts = {
			appPath,
			method: 'GET'
		};
		return this.callEnsuringLogin<WebSocket>(() => {
			this.prepCallOpts(opts, true);
			return openSocket(opts.url!, opts.sessionId!);
		});
	}
	
}
Object.freeze(ServiceUser.prototype);
Object.freeze(ServiceUser);

Object.freeze(exports);