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
 * This defines functions that implement ASMail delivery protocol.
 */

import { doBodylessRequest, doJsonRequest, doBinaryRequest, makeException }
	from '../xhr-utils';
import * as api from '../../lib-common/service-api/asmail/delivery';
import { user as mid } from '../../lib-common/mid-sigs-NaCl-Ed';
import { asmailInfoAt } from '../service-locator';
import { RuntimeException, makeRuntimeException }
	from '../../lib-common/exceptions/runtime';
let Uri = require('jsuri');

const LIMIT_ON_MAX_CHUNK = 1024*1024;

export const EXCEPTION_TYPE = 'asmail-delivery';

type ASMailSendException = web3n.asmail.ASMailSendException;

export class MailSender {
	
	sessionId: string = (undefined as any);
	maxMsgLength: number = (undefined as any);
	redirectedFrom: string = (undefined as any);
	recipientPubKeyCerts: api.initPubKey.Reply = (undefined as any);
	msgId: string = (undefined as any);
	maxChunkSize = LIMIT_ON_MAX_CHUNK;
	
	private uri: string = (undefined as any);
	get deliveryURI(): string {
		if (typeof this.uri !== 'string') { throw new Error(
			`Delivery uri is not initialized.`); }
		return this.uri;
	}
	private get serviceDomain(): string {
		return (new Uri(this.uri)).host();
	}
	
	/**
	 * @param sender is a string with sender's mail address, or undefined,
	 * for anonymous sending (non-authenticated).
	 * @param recipient is a required string with recipient's mail address.
	 * @param invitation is an optional string token, used with either anonymous
	 * (non-authenticated) delivery, or in a more strict delivery control in
	 * authenticated setting.
	 */
	constructor(
			public sender: string|undefined,
			public recipient: string,
			public invitation?: string) {
		Object.seal(this);
	}

	async setDeliveryUrl(serviceUrl: string): Promise<void> {
		let info = await asmailInfoAt(serviceUrl);
		if (!info.delivery) { throw new Error(`Missing delivery service url in ASMail information at ${serviceUrl}`); }
		this.uri = info.delivery;
	}
	
	private makeException(flag: string): ASMailSendException {
		let exc = <ASMailSendException> makeRuntimeException(
			flag, EXCEPTION_TYPE);
		exc.address = this.recipient;
		return exc;
	}
	
	private badRedirectExc(): ASMailSendException {
		return this.makeException('badRedirect');
	}
	
	private unknownRecipientExc(): ASMailSendException {
		return this.makeException('unknownRecipient');
	}
	
	private senderNotAllowedExc(): ASMailSendException {
		return this.makeException('senderNotAllowed');
	}
	
	private inboxIsFullExc(): ASMailSendException {
		return this.makeException('inboxIsFull');
	}
	
	private authFailedOnDeliveryExc(): ASMailSendException {
		return this.makeException('authFailedOnDelivery');
	}

	private recipientHasNoPubKeyExc(): ASMailSendException {
		return this.makeException('recipientHasNoPubKey');
	}

	/**
	 * This method throws, if given message size is greater that a maximum
	 * message size that server is willing to take.
	 * @param msgSize is a total number of bytes for all message objects.
	 */
	ensureMsgFitsLimits(msgSize: number): void {
		if (typeof this.maxMsgLength !== 'number') { throw new Error(`Premature call to ensure size fit: maximum message length isn't set.`); }
		if (msgSize > this.maxMsgLength) {
			let exc: ASMailSendException = this.makeException('msgTooBig');
			exc.allowedSize = this.maxMsgLength;
			throw exc;
		}
	}
	
	private prepareRedirectOrThrowUp(rep: api.sessionStart.RedirectReply): void {
		if (("string" !== typeof rep.redirect) ||
				(rep.redirect.length === 0) ||
				((new Uri(rep.redirect)).protocol() !== 'https')) {
			throw this.badRedirectExc();
		}
		// refuse second redirect
		if (this.redirectedFrom !== null) {
			throw this.badRedirectExc();
		}
		// set params
		this.redirectedFrom = this.deliveryURI;
		this.uri = rep.redirect;
	}
	
	/**
	 * This performs a pre-flight, server will provide the same information,
	 * as in session start, except that non session shall be opened a session.
	 * @return a promise, resolvable to reply info object with maxMsgLength.
	 * These values are also set in the fields of this sender.
	 * Failed promise's propagated error object may have an error status field:
	 *  403 is for not allowing to leave mail,
	 *  474 indicates unknown recipient,
	 *  480 tells that recipient's mailbox full.
	 */
	async performPreFlight(): Promise<api.preFlight.Reply> {
		let reqData: api.preFlight.Request = {
			sender: this.sender,
			recipient: this.recipient,
			invitation: this.invitation
		};
		let rep = await doJsonRequest<api.preFlight.Reply>({
			url: this.deliveryURI + api.preFlight.URL_END,
			method: 'POST',
			responseType: 'json'
		}, reqData);
		if (rep.status === api.preFlight.SC.ok) {
			if (typeof rep.data.maxMsgLength !== 'number') {
				throw makeException(rep,
					'Malformed reply: missing number maxMsgLength');
			}
			if (rep.data.maxMsgLength < 500) {
				throw makeException(rep,
					'Malformed reply: maxMsgLength is too short');
			}
			this.maxMsgLength = rep.data.maxMsgLength;
			return rep.data;
		} else if (rep.status == api.preFlight.SC.redirect) {
			this.prepareRedirectOrThrowUp(<any> rep.data);
			return this.performPreFlight();
		} else if (rep.status == api.preFlight.SC.unknownRecipient) {
			throw this.unknownRecipientExc();
		} else if (rep.status == api.preFlight.SC.senderNotAllowed) {
			throw this.senderNotAllowedExc();
		} else if (rep.status == api.preFlight.SC.inboxFull) {
			throw this.inboxIsFullExc();
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	/**
	 * This performs the very first, mandatory request to server, telling server
	 * who message is intended to, and whether this is an anonymous sender
	 * delivery.
	 * @return a promise, resolvable to reply info object with sessionId and
	 * maxMsgLength.
	 * These values are also set in the fields of this sender.
	 * Failed promise's propagated error object may have an error status field:
	 *  403 is for not allowing to leave mail,
	 *  474 indicates unknown recipient,
	 *  480 tells that recipient's mailbox full.
	 */
	async startSession(): Promise<api.sessionStart.Reply> {
		let reqData: api.sessionStart.Request = {
			sender: this.sender,
			recipient: this.recipient,
			invitation: this.invitation
		};
		let rep = await doJsonRequest<api.sessionStart.Reply>({
			url: this.deliveryURI + api.sessionStart.URL_END,
			method: 'POST',
			responseType: 'json'
		}, reqData);
		if (rep.status == api.sessionStart.SC.ok) {
			if (typeof rep.data.maxMsgLength !== 'number') {
				throw makeException(rep,
					'Malformed reply: missing number maxMsgLength');
			}
			if (rep.data.maxMsgLength < 500) {
				throw makeException(rep,
					'Malformed reply: maxMsgLength is too short');
			}
			this.maxMsgLength = rep.data.maxMsgLength;
			if ('string' !== typeof rep.data.sessionId) {
				throw makeException(rep,
					'Malformed reply: missing sessionId string');
			}
			this.sessionId = rep.data.sessionId;
			delete rep.data.sessionId;
			return rep.data;
		} else if (rep.status == api.sessionStart.SC.redirect) {
			this.prepareRedirectOrThrowUp(<any> rep.data);
			return this.startSession();
		} else if (rep.status == api.preFlight.SC.unknownRecipient) {
			throw this.unknownRecipientExc();
		} else if (rep.status == api.preFlight.SC.senderNotAllowed) {
			throw this.senderNotAllowedExc();
		} else if (rep.status == api.preFlight.SC.inboxFull) {
			throw this.inboxIsFullExc();
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	/**
	 * This sends mailerId assertion for sender authorization.
	 * @param assertionSigner is a MailerId assertion signer
	 * @return a promise for request completion.
	 * Rejected promise passes an error object, conditionally containing
	 * status field.
	 */
	async authorizeSender(assertionSigner: mid.MailerIdSigner): Promise<void> {
		let assertion = assertionSigner.generateAssertionFor(
			this.serviceDomain, this.sessionId);
		let reqData: api.authSender.Request = {
			assertion: assertion,
			userCert: assertionSigner.userCert,
			provCert: assertionSigner.providerCert
		};
		let rep = await doJsonRequest<void>({
			url: this.deliveryURI.toString() + api.authSender.URL_END,
			method: 'POST',
			sessionId: this.sessionId
		}, reqData);
		if (rep.status === api.authSender.SC.ok) { return; }
		this.sessionId = (undefined as any);
		if (rep.status === api.authSender.SC.authFailed) {
			throw this.authFailedOnDeliveryExc();
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	/**
	 * This gets recipients initial public key to launch message exchange.
	 * @return a promise resolvable to certificates, received from server.
	 * Certificates are also set in the field of this sender.
	 * Rejected promise passes an error object, conditionally containing
	 * status field.
	 */
	async getRecipientsInitPubKey(): Promise<api.initPubKey.Reply> {
		let rep = await doBodylessRequest<api.initPubKey.Reply>({
			url: this.deliveryURI + api.initPubKey.URL_END,
			method: 'GET',
			sessionId: this.sessionId,
			responseType: 'json'
		});
		if (rep.status === api.initPubKey.SC.ok) {
			this.recipientPubKeyCerts = rep.data;
			return this.recipientPubKeyCerts;
		} else if (rep.status === api.initPubKey.SC.pkeyNotRegistered) {
			throw this.recipientHasNoPubKeyExc();
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}

	/**
	 * This method sends message metadata.
	 * @param md is a json-shaped message metadata, to be send to server
	 * @return a promise, resolvable on 201-OK response to json with msgId,
	 * and optional min and max limits on object chunks.
	 * These values are also set in the fields of this sender.
	 * Not-OK responses reject promises.
	 */
	async sendMetadata(meta: api.msgMeta.Request): Promise<api.msgMeta.Reply> {
		let rep = await doJsonRequest<api.msgMeta.Reply>({
			url: this.deliveryURI + api.msgMeta.URL_END,
			method: 'PUT',
			sessionId: this.sessionId,
			responseType: 'json'
		}, meta);
		if (rep.status == api.msgMeta.SC.ok) {
			if (('string' !== typeof rep.data.msgId) ||
					(rep.data.msgId.length === 0)) {
				throw makeException(rep,
					'Malformed reply: msgId string is missing');
			}
			this.msgId = rep.data.msgId;
			if (typeof rep.data.maxChunkSize === 'number') {
				if (rep.data.maxChunkSize < 64*1024) {
					throw makeException(rep,
						'Malformed reply: maxChunkSize is too small');
				} else if (rep.data.maxChunkSize > LIMIT_ON_MAX_CHUNK) {
					this.maxChunkSize = LIMIT_ON_MAX_CHUNK;
				} else {
					this.maxChunkSize = rep.data.maxChunkSize;
				}
			}
			return rep.data;
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	private async sendBytes(url: string, bytes: Uint8Array): Promise<void> {
		let rep = await doBinaryRequest<void>({
			url,
			method: 'PUT',
			sessionId: this.sessionId
		}, bytes);
		if (rep.status !== api.msgObjSegs.SC.ok) {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	sendObjHeadChunk(objId: string, offset: number, chunk: Uint8Array,
			totalHeadLen?: number): Promise<void> {
		let opts: api.BlobQueryOpts = {
			append: false,
			ofs: offset
		};
		if (typeof totalHeadLen === 'number') {
			opts.total = totalHeadLen;
		}
		let url = this.deliveryURI + api.msgObjHeader.genUrlEnd(objId, opts);
		return this.sendBytes(url, chunk);
	}
	
	sendObjSegsChunk(objId: string, offset: number, chunk: Uint8Array,
			totalSegsLen?: number): Promise<void> {
		let opts: api.BlobQueryOpts = {
			append: false,
			ofs: offset
		};
		if ('number' === typeof totalSegsLen) {
			opts.total = totalSegsLen;
		}
		let url = this.deliveryURI + api.msgObjSegs.genUrlEnd(objId, opts);
		return this.sendBytes(url, chunk);
	}
	
	appendObjHead(objId: string, chunk: Uint8Array, isFirst?: boolean):
			Promise<void> {
		let opts: api.BlobQueryOpts = {
			append: true
		};
		if (isFirst) {
			opts.total = -1;
		}
		let url = this.deliveryURI + api.msgObjHeader.genUrlEnd(objId, opts);
		return this.sendBytes(url, chunk);
	}
	
	appendObjSegs(objId: string, chunk: Uint8Array, isFirst?: boolean):
			Promise<void> {
		let opts: api.BlobQueryOpts = {
			append: true
		};
		if (isFirst) {
			opts.total = -1;
		}
		let url = this.deliveryURI + api.msgObjSegs.genUrlEnd(objId, opts);
		return this.sendBytes(url, chunk);
	}

	/**
	 * @return a promise, resolvable when message delivery closing.
	 */
	async completeDelivery(): Promise<void> {
		let rep = await doBodylessRequest<void>({
			url: this.deliveryURI.toString() + api.completion.URL_END,
			method: 'POST',
			sessionId: this.sessionId
		});
		if (rep.status === api.completion.SC.ok) {
			this.sessionId = (undefined as any);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
}
Object.freeze(MailSender);
Object.freeze(MailSender.prototype);

Object.freeze(exports);