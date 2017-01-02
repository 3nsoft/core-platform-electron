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
 * This defines functions that implement ASMail reception protocol.
 */

import { makeException as makeXhrException } from '../xhr-utils';
import { RuntimeException, makeRuntimeException }
	from '../../lib-common/exceptions/runtime';
import * as api from '../../lib-common/service-api/asmail/retrieval';
import { ServiceUser, IGetMailerIdSigner } from '../user-with-mid-session';
import { asmailInfoAt } from '../service-locator';

export const EXCEPTION_TYPE = "inbox";

export function makeMsgNotFoundException(msgId: string):
		web3n.asmail.InboxException {
	let exc = <web3n.asmail.InboxException> makeRuntimeException(
		'msgNotFound', EXCEPTION_TYPE);
	exc.msgId = msgId;
	return exc;
}

export function makeObjNotFoundException(msgId: string, objId: string):
		web3n.asmail.InboxException {
	let exc = <web3n.asmail.InboxException> makeRuntimeException(
		'objNotFound', EXCEPTION_TYPE);
	exc.msgId = msgId;
	exc.objId = objId;
	return exc;
}

export function makeMsgIsBrokenException(msgId: string):
		web3n.asmail.InboxException {
	let exc = <web3n.asmail.InboxException> makeRuntimeException(
		'msgIsBroken', EXCEPTION_TYPE);
	exc.msgId = msgId;
	return exc;
}

export class MailRecipient extends ServiceUser {
	
	private serviceURIGetter: () => Promise<string> = (undefined as any);

	constructor(user: string, getSigner: IGetMailerIdSigner) {
		super(user, {
			login: api.midLogin.MID_URL_PART,
			logout: api.closeSession.URL_END,
			canBeRedirected: true
		}, getSigner);
		Object.seal(this);
	}

	private async setServiceUrl(serviceUrl?: string): Promise<void> {
		if (!serviceUrl) {
			serviceUrl = await this.serviceURIGetter();
		}
		let info = await asmailInfoAt(serviceUrl);
		if (!info.retrieval) { throw new Error(`Missing retrieval service url in ASMail information at ${serviceUrl}`); }
		this.serviceURI = info.retrieval;
	}

	async setRetrievalUrl(serviceUrl: string|(() => Promise<string>)):
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
	
	async listMsgs(fromTS: number): Promise<api.listMsgs.Reply> {
		// if (!this.isSet())
		
		// XXX modify request to take fromTS parameter to limit number of msgs
		
		let rep = await this.doBodylessSessionRequest<api.listMsgs.Reply>({
			path: api.listMsgs.URL_END,
			method: 'GET',
			responseType: 'json'
		});
		if (rep.status === api.listMsgs.SC.ok) {
			if (!Array.isArray(rep.data)) {
				throw makeXhrException(rep, 'Malformed response');
			}
			return rep.data;
		} else {
			throw makeXhrException(rep, 'Unexpected status');
		}
	}

	async getMsgMeta(msgId: string): Promise<api.MsgMeta> {
		let rep = await this.doBodylessSessionRequest<api.MsgMeta>({
			path: api.msgMetadata.genUrlEnd(msgId),
			method: 'GET',
			responseType: 'json'
		});
		if (rep.status === api.msgMetadata.SC.ok) {
			if (!rep.data || (typeof rep.data !== 'object')) {
				throw makeXhrException(rep, 'Malformed response');
			}
			return rep.data;
		} else if (rep.status === api.msgMetadata.SC.unknownMsg) {
			throw makeMsgNotFoundException(msgId);
		} else {
			throw makeXhrException(rep, 'Unexpected status');
		}
	}

	private async getBytes(path: string, msgId: string, objId: string):
			Promise<Uint8Array> {
		let rep = await this.doBodylessSessionRequest<Uint8Array>(
			{ path, method: 'GET', responseType: 'arraybuffer' });
		if (rep.status === api.msgObjSegs.SC.ok) {
			if (!rep.data) {
				throw makeXhrException(rep, 'Malformed response');
			}
			return rep.data;
		} else if (rep.status === api.msgObjSegs.SC.unknownMsgOrObj) {
			throw makeObjNotFoundException(msgId, objId);
		} else {
			throw makeXhrException(rep, 'Unexpected status');
		}
	}
	
	getObjHead(msgId: string, objId: string): Promise<Uint8Array> {
		let path = api.msgObjHeader.genUrlEnd(msgId, objId);
		return this.getBytes(path, msgId, objId);
	}

	getObjSegs(msgId: string, objId: string, opts?: api.BlobQueryOpts):
			Promise<Uint8Array> {
		let path = api.msgObjSegs.genUrlEnd(msgId, objId, opts);
		return this.getBytes(path, msgId, objId);
	}

	async removeMsg(msgId: string): Promise<void> {
		let rep = await this.doBodylessSessionRequest<void>({
			path: api.rmMsg.genUrlEnd(msgId),
			method: 'DELETE'
		});
		if (rep.status === api.rmMsg.SC.ok) {
			return;
		} else if (rep.status === api.rmMsg.SC.unknownMsg) {
			throw makeMsgNotFoundException(msgId);
		} else {
			throw makeXhrException(rep, 'Unexpected status');
		}
	}
	
}
Object.freeze(MailRecipient);
Object.freeze(MailRecipient.prototype);

Object.freeze(exports);