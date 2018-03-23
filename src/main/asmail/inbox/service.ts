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

import { StorageGetter } from '../../../lib-client/3nstorage/xsp-fs/common';
import { ConnectException } from '../../../lib-common/exceptions/http';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { NamedProcs } from '../../../lib-common/processes';
import { MailRecipient, makeMsgNotFoundException }
	from '../../../lib-client/asmail/recipient';
import { getASMailServiceFor } from '../../../lib-client/service-locator';
import { OpenedMsg, openMsg, headers }
	from '../../../lib-client/asmail/msg/opener';
import { KeyRing } from '../keyring';
import { InboxCache, MsgStatus } from './cache';
import { Downloader } from './downloader';
import { MsgIndex } from './msg-indexing';
import { makeCachedObjSource } from './cached-obj-source';
import { fsForAttachments } from './attachments/fs';
import { bind } from '../../../lib-common/binding';
import { areAddressesEqual } from '../../../lib-common/canonical-address';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { base64 } from '../../../lib-common/buffer-utils';
import { checkAndExtractPKeyWithAddress } from '../key-verification';
import * as confApi from '../../../lib-common/service-api/asmail/config';
import { JsonKey } from '../../../lib-common/jwkeys';
import { InboxEvents } from './inbox-events';
import { GetSigner } from '../../id-manager';
import { logError } from '../../../lib-client/logging/log-to-file';
import { TimeWindowCache } from '../../../lib-common/time-window-cache';
import { AsyncSBoxCryptor } from 'xsp-files';

type MsgInfo = web3n.asmail.MsgInfo;
type IncomingMessage = web3n.asmail.IncomingMessage;
type WritableFS = web3n.files.WritableFS;
type InboxService = web3n.asmail.InboxService;

/**
 * Instance of this class represents inbox-on-mail-server.
 * It uses api to manage messages on a ASMail server, caching and recording
 * some information to allow faster response, and to keep message keys, while
 * messages have not been removed via direct action or due to expiry.
 * This object is also responsible for expiring messages on the server.
 */
export class InboxOnServer {
	
	private index: MsgIndex = (undefined as any);
	private msgReceiver: MailRecipient = (undefined as any);
	private inboxEvents: InboxEvents = (undefined as any);
	private procs = new NamedProcs();
	private cache: InboxCache = (undefined as any);
	private downloader: Downloader = (undefined as any);
	private recentlyOpenedMsgs = new TimeWindowCache<string, OpenedMsg>(60*1000);
	
	constructor(
			private address: string,
			private getSigner: GetSigner,
			private keyring: KeyRing,
			private storages: StorageGetter,
			private cryptor: AsyncSBoxCryptor) {
		Object.seal(this);
	}

	/**
	 * This method must be called prior any use of this object.
	 * This call returns a promise, resolvable when initialization completes.
	 * @param cache is inbox cache, backed by device's file system
	 * @param fs
	 */
	async init(cache: InboxCache, fs: WritableFS): Promise<void> {
		try {
			this.cache = cache;
			this.msgReceiver = new MailRecipient(this.address, this.getSigner,
				() => getASMailServiceFor(this.address));
			this.downloader = new Downloader(this.cache, this.msgReceiver);
			this.index = new MsgIndex(fs);
			await this.index.init();
			this.inboxEvents = new InboxEvents(
				this.msgReceiver, bind(this, this.getMsg));
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize Inbox');
		}
	}

	wrap(): InboxService {
		const service: InboxService = {
			getMsg: bind(this, this.getMsg),
			listMsgs: bind(this, this.listMsgs),
			removeMsg: bind(this, this.removeMsg),
			subscribe: bind(this.inboxEvents, this.inboxEvents.subscribe)
		};
		return Object.freeze(service);
	}
	
	private async removeMsg(msgId: string): Promise<void> {
		// check for an already started process
		const procId = 'removal of '+msgId;
		const promise = this.procs.getP<void>(procId);
		if (promise) { return promise; }
		// start removal process
		return this.procs.start<any>(procId, (async () => {
			await Promise.all([
				this.index.removeUsingIdOnly(msgId),
				this.removeMsgFromServerAndCache(msgId)
			]);
		}));
	}

	private async removeMsgFromServerAndCache(msgId: string): Promise<void> {
		await Promise.all([
			this.cache.deleteMsg(msgId),
			this.msgReceiver.removeMsg(msgId).catch((exc) => {})
		]);
	}
	
	private async startCachingAndAddKeyToIndex(msgId: string): Promise<boolean> {
		// start download to ensure that meta is in the cache
		const msgStatus = await this.downloader.startMsgDownload(msgId);
		if (msgStatus.keyStatus !== 'not-checked') { throw new Error(
			`Unexpected key status ${msgStatus.keyStatus} of message ${msgId}`); }

		const meta = await this.cache.getMsgMeta(msgId);
		try {
			
			// setup closures, some memoized, for use by keyring
			let mainObjSrc: ObjSource|undefined = undefined;
			const getMainObjHeader = async (): Promise<Uint8Array> => {
				if (!mainObjSrc) {
					mainObjSrc = await makeCachedObjSource(
						this.cache, this.downloader, msgId, msgStatus.mainObjId);
				}
				return mainObjSrc.readHeader();
			};
			const getOpenedMsg = async (mainObjFileKey: string,
					msgKeyPackLen: number): Promise<OpenedMsg> => {
				if (!mainObjSrc) {
					mainObjSrc = await makeCachedObjSource(
						this.cache, this.downloader, msgId, msgStatus.mainObjId);
				}
				const fKey = base64.open(mainObjFileKey);
				const openedMsg = await openMsg(msgId, msgStatus.mainObjId,
					mainObjSrc, msgKeyPackLen, fKey, this.cryptor);
				fKey.fill(0);
				return openedMsg;
			};
			const checkMidKeyCerts = (certs: confApi.p.initPubKey.Certs):
					Promise<{ pkey: JsonKey; address: string; }> => {
				return checkAndExtractPKeyWithAddress(
					this.msgReceiver.getNet(), certs,
					Math.round(msgStatus.deliveryTS / 1000));
			};

			const decrOut = await this.keyring.decrypt(
				meta.extMeta, msgStatus.deliveryTS,
				getMainObjHeader, getOpenedMsg, checkMidKeyCerts);

			if (decrOut) {
				// if sender authenticated to server, check that it matches address,
				// recovered from message decryption 
				const { decrInfo, openedMsg } = decrOut;
				openedMsg.setMsgKeyRole(decrInfo.keyStatus);
				this.recentlyOpenedMsgs.set(msgId, openedMsg);
				if (meta.authSender &&
						!areAddressesEqual(meta.authSender, decrInfo.correspondent)) {
					throw new Error(`Sender authenticated to server as ${meta.authSender}, while decrypting key is associated with ${decrInfo.correspondent}`);
				}
				const msgInfo: MsgInfo = {
					msgType: openedMsg.getHeader(headers.MSG_TYPE),
					msgId,
					deliveryTS: msgStatus.deliveryTS
				};
				// add records to index and cache
				await this.index.add(msgInfo, decrInfo);
			} else {
				// check, if msg has already been indexed
				const knownDecr = await this.index.fKeyFor(
					{ msgId, deliveryTS: msgStatus.deliveryTS });
				if (!knownDecr) {
					await this.cache.updateMsgKeyStatus(msgId, 'not-found');
					return false;
				}

				// TODO try to open main message, just as a check

			}
			await this.cache.updateMsgKeyStatus(msgId, 'ok');
			return true;
		} catch (exc) {
			await this.cache.updateMsgKeyStatus(msgId, 'fail');
			await logError(exc, `Problem with opening message ${msgId}`);
			return false;
		}
	}
	
	
	private async listMsgs(fromTS?: number): Promise<MsgInfo[]> {
		const checkServer = true;	// XXX in future this will be an option from req
		if (!checkServer) { return this.index.listMsgs(fromTS); }

		// check for an already started process
		const procId = 'listing msgs';
		const promise = this.procs.getP<MsgInfo[]>(procId);
		if (promise) { return promise; }
		// start message listing process
		return this.procs.start(procId, async () => {
			// message listing info is located in index, yet, process involves
			// getting and caching messages' metadata
			let msgIds: string[];
			try {
				msgIds = await this.msgReceiver.listMsgs(fromTS);
			} catch (exc) {
				if ((exc as ConnectException).type !== 'http-connect') {
					throw exc; }
				return this.index.listMsgs(fromTS);
			}
			const indexedMsgs = await this.index.listMsgs(fromTS);
			for (const info of indexedMsgs) {
				const ind = msgIds.indexOf(info.msgId);
				if (ind >= 0) {
					msgIds.splice(ind, 1);
				}
			}
			if (msgIds.length === 0) { return indexedMsgs; }
			const keying = msgIds.map(msgId =>
				this.startCachingAndAddKeyToIndex(msgId).catch(async (exc) => {
					await logError(exc, `Failed to start caching message ${msgId}`);
				}));
			await Promise.all(keying);
			return this.index.listMsgs(fromTS);
		});
	}
	
	private async getMsg(msgId: string): Promise<IncomingMessage> {
		if (!msgId || (typeof msgId !== 'string')) {
			throw `Given message id is not a non-empty string`; }
		const procId = `get msg #${msgId}`;
		const promise = this.procs.getP<IncomingMessage>(procId);
		if (promise) { return promise; }
		return this.procs.start(procId, async () => {
			
			let msgStatus = await this.cache.findMsg(msgId);
			if (!msgStatus) {
				await this.downloader.startMsgDownload(msgId);
				msgStatus = (await this.cache.findMsg(msgId, true))!;
			}
			
			let msg = this.recentlyOpenedMsgs.get(msgId);
			if (!msg) {

				const meta = await this.cache.getMsgMeta(msgId);
				
				if ((msgStatus.keyStatus === 'not-found') ||
						(msgStatus.keyStatus === 'fail')) {
					// XXX 
					// message cannot be opened, and should be removed
					// await Promise.all([
					// 	this.index.remove(msgInfo),
					// 	this.removeMsgFromServerAndCache(msgId)
					// ]);
					throw makeMsgNotFoundException(msgId);
				} else if (msgStatus.keyStatus === 'not-checked') {
					await this.startCachingAndAddKeyToIndex(msgId);
				} else if (msgStatus.keyStatus !== 'ok') {
					throw new Error(`Unknown message key status ${msgStatus.keyStatus}`);
				}

				const mainObjId = meta.extMeta.objIds[0];
				const mainObj = await makeCachedObjSource(
					this.cache, this.downloader, msgId, mainObjId);
				const msgKey = await this.index.fKeyFor(
					{ msgId, deliveryTS: meta.deliveryCompletion! });
				if (!msgKey) {
					throw makeMsgNotFoundException(msgId);
				}
				
				msg = await openMsg(msgId, mainObjId, mainObj,
					msgKey.mainObjHeaderOfs, msgKey.msgKey, this.cryptor);
				msg.setMsgKeyRole(msgKey.msgKeyRole);
			}

			return this.msgToUIForm(msg, msgStatus.deliveryTS);
		});
	}

	private msgToUIForm(msg: OpenedMsg, deliveryTS: number): IncomingMessage {
		const m: IncomingMessage = {
			sender: msg.getSender(),
			establishedSenderKeyChain: msg.establishedKeyChain,
			msgId: msg.msgId,
			deliveryTS,
			msgType: msg.getHeader(headers.MSG_TYPE),
			subject: msg.getHeader(headers.SUBJECT),
			carbonCopy: msg.getHeader(headers.CC),
			recipients: msg.getHeader(headers.TO)
		};
		const body = msg.getMainBody();
		if (body.text) {
			if (typeof body.text.plain === 'string') {
				m.plainTxtBody = body.text.plain;
			}
			if (typeof body.text.html === 'string') {
				m.htmlTxtBody = body.text.html;
			}
		}
		if (body.json !== undefined) {
			m.jsonBody = body.json;
		}
		const attachments = msg.getAttachmentsJSON();
		if (attachments) {
			m.attachments = fsForAttachments(this.downloader, this.cache,
				m.msgId, attachments, this.storages, this.cryptor);
		}
		return m;
	}
	
}
Object.freeze(InboxOnServer.prototype);
Object.freeze(InboxOnServer);

Object.freeze(exports);