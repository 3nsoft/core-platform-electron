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
 * This defines functions that implement ASMail configuration protocol.
 */

import { makeException } from '../xhr-utils';
import * as api from '../../lib-common/service-api/asmail/config';
import { user as mid } from '../../lib-common/mid-sigs-NaCl-Ed';
import { HTTPException, makeConnectionException }
	from '../../lib-common/exceptions/http';
import { ServiceUser, IGetMailerIdSigner } from '../user-with-mid-session';
import { asmailInfoAt } from '../service-locator';

export class MailConfigurator extends ServiceUser {
	
	private serviceURIGetter: () => Promise<string> = (undefined as any);
	
	paramsOnServer: {
		[name: string]: any;
	};
	
	constructor(userId: string, getSigner: IGetMailerIdSigner) {
		super(userId, {
			login: api.midLogin.MID_URL_PART,
			logout: api.closeSession.URL_END,
			canBeRedirected: true
		}, getSigner);
		this.paramsOnServer = {};
		Object.seal(this);
	}

	private async setServiceUrl(serviceUrl?: string): Promise<void> {
		if (!serviceUrl) {
			serviceUrl = await this.serviceURIGetter();
		}
		let info = await asmailInfoAt(serviceUrl);
		if (!info.config) { throw new Error(`Missing configuration service url in ASMail information at ${serviceUrl}`); }
		this.serviceURI = info.config;
	}

	async setConfigUrl(serviceUrl: string|(() => Promise<string>)):
			Promise<void> {
		if (typeof serviceUrl === 'string') {
			await this.setServiceUrl(serviceUrl);
		} else {
			this.serviceURIGetter = serviceUrl;
		}
	}
	
	/**
	 * This method hides super from await, till ES7 comes with native support
	 * for await.
	 */
	private super_login(): Promise<void> {
		return super.login();
	}
	
	/**
	 * This does MailerId login with a subsequent getting of session parameters
	 * from 
	 * @return a promise, resolvable, when mailerId login and getting parameters'
	 * successfully completes.
	 */
	async login(): Promise<void> {
		if (!this.isSet) {
			await this.setServiceUrl();
		}
		await this.super_login();
	}
	
	async getParam<T>(urlEnd: string): Promise<T> {
		let rep = await this.doBodylessSessionRequest<T>({
			path: urlEnd,
			method: 'GET',
			responseType: 'json'
		});
		if (rep.status !== api.PARAM_SC.ok) {
			throw makeException(rep, 'Unexpected status');
		}
		return rep.data;
	}
	
	async setParam<T>(urlEnd: string, param: T): Promise<void> {
		let rep = await this.doJsonSessionRequest<void>({
			path: urlEnd,
			method: 'PUT',
		}, param);
		if (rep.status !== api.PARAM_SC.ok) {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
}
Object.freeze(MailConfigurator.prototype);
Object.freeze(MailConfigurator);

Object.freeze(exports);