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

import { Duplex, RequestEnvelope } from '../../lib-common/ipc/electron-ipc';
import { FS, StorageGetter } from '../../lib-client/3nstorage/xsp-fs/common';
import { ConnectException, ConnectExceptionType }
	from '../../lib-common/exceptions/http';
import { errWithCause } from '../../lib-common/exceptions/error';
import { NamedProcs } from '../../lib-common/processes';
import { MailRecipient, makeMsgIsBrokenException, makeMsgNotFoundException }
	from '../../lib-client/asmail/recipient';
import { getASMailServiceFor } from '../../lib-client/service-locator';
import { OpenedMsg, openMsg, HEADERS } from '../../lib-client/asmail/msg';
import { KeyRing, MsgDecrInfo } from './keyring';
import { IGetSigner, asmail, FSDetails } from '../../renderer/common';
import { InboxCache, MsgStatus } from './inbox-cache';
import { Downloader } from './downloader';
import { Exception as CacheException, ExceptionType as CacheExceptionType }
	from '../../lib-client/local-files/generational-cache';
import { MsgIndex } from './inbox-index';
import { makeCachedObjSource } from './cached-obj-source';
import { fsForAttachments } from './attachments/fs';
import { bind } from '../../lib-common/binding';
import { areAddressesEqual } from '../../lib-common/canonical-address';
import { ObjSource } from '../../lib-common/obj-streaming/common';
import { base64 } from '../../lib-common/buffer-utils';
import { makeHolderFor } from 'xsp-files';
import { checkAndExtractPKeyWithAddress } from './key-verification';
import * as confApi from '../../lib-common/service-api/asmail/config';
import { JsonKey } from '../../lib-common/jwkeys';

type EncryptionException = web3n.EncryptionException;
type MsgInfo = web3n.asmail.MsgInfo;
type IncomingMessage = web3n.asmail.IncomingMessage;

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
	private uiSide: Duplex = (undefined as any);
	private procs = new NamedProcs();
	private cache: InboxCache = (undefined as any);
	private downloader: Downloader = (undefined as any);
	private fsProxyRegister: (fs: FS) => FSDetails = (undefined as any);
	
	constructor(
			private address: string,
			private getSigner: IGetSigner,
			private keyring: KeyRing,
			private storages: StorageGetter) {
		Object.seal(this);
	}
	
	attachTo(uiSide: Duplex, fsProxyRegister: (fs: FS) => FSDetails): void {
		this.uiSide = uiSide;
		this.fsProxyRegister = fsProxyRegister;
		this.attachHandlersToUI();
	}
	
	private attachHandlersToUI(): void {
		let inboxNames = asmail.uiReqNames.inbox;
		this.uiSide.addHandler(inboxNames.listMsgs,
			bind(this, this.handleListMsgs));
		this.uiSide.addHandler(inboxNames.removeMsg,
			bind(this, this.handleRemoveMsg));
		this.uiSide.addHandler(inboxNames.getMsg,
			bind(this, this.handleGetMsg));
	}

	/**
	 * @param cache is inbox cache, backed by device's file system
	 * @return a promise, resolvable when initialization completes.
	 * This object cannot be used prior to initialization completion.
	 */
	async init(cache: InboxCache, inboxFS: FS): Promise<void> {
		try {
			this.cache = cache;
			this.msgReceiver = new MailRecipient(this.address, this.getSigner);
			this.msgReceiver.setRetrievalUrl(() => {
				return getASMailServiceFor(this.address);
			});
			this.downloader = new Downloader(this.cache, this.msgReceiver);
			this.index = new MsgIndex(inboxFS);
			await this.index.init();
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize Inbox');
		}
	}
	
	/**
	 * Removes message from a server, and cleans respective cache.
	 * @param env with an id of a message that should be removed/deleted
	 * @return a promise, resolvable when server completes message removal.
	 */
	private async handleRemoveMsg(env: RequestEnvelope<string>): Promise<void> {
		let msgId = env.req;
		// check for an already started process
		let procId = 'removal of '+msgId;
		let promise = this.procs.getP<void>(procId);
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
		let msgStatus = await this.downloader.startMsgDownload(msgId);
		if (msgStatus.keyStatus !== 'not-checked') { throw new Error(
			`Unexpected key status ${msgStatus.keyStatus} of message ${msgId}`); }
		let msgInfo: MsgInfo = {
			msgId,
			deliveryTS: msgStatus.deliveryTS
		};
		
		let meta = await this.cache.getMsgMeta(msgId);
		try {
			
			// setup closures, some memoized, for use by keyring
			let mainObjSrc: ObjSource|undefined = undefined;
			let getMainObjHeader = async (): Promise<Uint8Array> => {
				if (!mainObjSrc) {
					mainObjSrc = await makeCachedObjSource(
						this.cache, this.downloader, msgId, msgStatus.mainObjId);
				}
				return mainObjSrc.readHeader();
			};
			let openedMsg: OpenedMsg|undefined = undefined;
			let getOpenedMsg = async (mainObjFileKey: string): Promise<OpenedMsg> => {
				if (!openedMsg) {
					if (!mainObjSrc) {
						mainObjSrc = await makeCachedObjSource(
							this.cache, this.downloader, msgId, msgStatus.mainObjId);
					}
					let fKeyHolder = makeHolderFor(
						base64.open(mainObjFileKey), await mainObjSrc.readHeader());
					openedMsg = await openMsg(msgId, mainObjSrc, fKeyHolder);
				}
				return openedMsg;
			};
			let checkMidKeyCerts = (certs: confApi.p.initPubKey.Certs):
					Promise<{ pkey: JsonKey; address: string; }> => {
				return checkAndExtractPKeyWithAddress(
					certs, msgStatus.deliveryTS/1000);
			};

			let decrInfo = await this.keyring.decrypt(
				meta.extMeta, msgStatus.deliveryTS,
				getMainObjHeader, getOpenedMsg, checkMidKeyCerts);
			
			if (decrInfo) {
				// if sender authenticated to server, check that it matches address,
				// recovered from message decryption 
				if (meta.authSender &&
						!areAddressesEqual(meta.authSender, decrInfo.correspondent)) {
					throw new Error(`Sender authenticated to server as ${meta.authSender}, while decrypting key is associated with ${decrInfo.correspondent}`);
				}
				// add records to index and cache
				await this.index.add(msgInfo, decrInfo);
			} else {
				// check, if msg has already been indexed
				let knownDecr = await this.index.fKeyFor(msgInfo);
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
			console.error(`Problem with opening message ${msgId}`);
			console.error(exc);
			return false;
		}
	}
	
	
	private async handleListMsgs(env: RequestEnvelope<number>):
			Promise<MsgInfo[]> {
		let fromTS = env.req;
		let checkServer = true;	// XXX in future this will be an option from req
		if (!checkServer) { return this.index.listMsgs(fromTS); }

		// check for an already started process
		let procId = 'listing msgs';
		let promise = this.procs.getP<MsgInfo[]>(procId);
		if (promise) { return promise; }
		// start message listing process
		return this.procs.start(procId, async () => {
			// message listing info is located in index, yet, process involves
			// getting and caching messages' metadata
			let msgIds: string[];
			try {
				msgIds = await this.msgReceiver.listMsgs(fromTS);
			} catch (exc) {
				if ((<ConnectException> exc).type !== ConnectExceptionType) {
					throw exc; }
				return this.index.listMsgs(fromTS);
			}
			let indexedMsgs = await this.index.listMsgs(fromTS);
			for (let info of indexedMsgs) {
				let ind = msgIds.indexOf(info.msgId);
				if (ind >= 0) {
					msgIds.splice(ind, 1);
				}
			}
			if (msgIds.length === 0) { return indexedMsgs; }
			let keying = msgIds.map(msgId =>
				this.startCachingAndAddKeyToIndex(msgId).catch((exc) => {
					console.error(`Failed to start caching message ${msgId} due to following error:`);
					console.error(exc);
				}));
			await Promise.all(keying);
			return this.index.listMsgs(fromTS);
		});
	}
	
	private async handleGetMsg(env: RequestEnvelope<string>):
			Promise<IncomingMessage> {
		let msgId = env.req;
		let procId = `get msg #${msgId}`;
		let promise = this.procs.getP<IncomingMessage>(procId);
		if (promise) { return promise; }
		return this.procs.start(procId, async () => {
			
			let msgStatus = await this.cache.findMsg(msgId);
			if (!msgStatus) {
				await this.downloader.startMsgDownload(msgId);
				msgStatus = (await this.cache.findMsg(msgId, true))!;
			}
			
			let meta = await this.cache.getMsgMeta(msgId);
			let msgInfo = {
				msgId,
				deliveryTS: meta.deliveryCompletion!
			};
			
			if ((msgStatus.keyStatus === 'not-found') ||
					(msgStatus.keyStatus === 'fail')) {
				// message cannot be opened, and should be removed
				// await Promise.all([
				// 	this.index.remove(msgInfo),
				// 	this.removeMsgFromServerAndCache(msgId)
				// ]);
				throw makeMsgNotFoundException(msgId);
			} else if (msgStatus.keyStatus === 'not-checked') {
				await this.startCachingAndAddKeyToIndex(msgId);
			}

			let mainObj = await makeCachedObjSource(this.cache, this.downloader,
				msgId, meta.extMeta.objIds[0]);
			let fKeyHolder = await this.index.fKeyFor(msgInfo);
			if (!fKeyHolder) {
				await this.removeMsgFromServerAndCache(msgId);
				throw makeMsgNotFoundException(msgId);
			}
			let msg = await openMsg(msgId, mainObj, fKeyHolder);

			return this.msgToUIForm(msg, msgStatus);
		});
	}

	private msgToUIForm(msg: OpenedMsg, msgStatus: MsgStatus): IncomingMessage {
		let m: IncomingMessage = {
			sender: msg.getSender(),
			msgId: msg.msgId,
			deliveryTS: msgStatus.deliveryTS,
			deliveryComplete: msgStatus.deliveryComplete,
			subject: msg.getHeader(HEADERS.SUBJECT),
			carbonCopy: msg.getHeader(HEADERS.CC),
			recipients: msg.getHeader(HEADERS.TO)
		};
		let body = msg.getMainBody();
		if (body.text) {
			if (body.text.plain) {
				m.plainTxtBody = body.text.plain;
			} else if (body.text.html) {
				m.htmlTxtBody = body.text.html;
			}
		}
		let attachments = msg.getAttachmentsJSON();
		if (attachments) {
			let fs = fsForAttachments(
				this.downloader, this.cache, m.msgId, attachments, this.storages);
			let fsInfo = this.fsProxyRegister(fs);
			m.attachments = (fsInfo as any);
		}
		return m;
	}
	
}
Object.freeze(InboxOnServer.prototype);
Object.freeze(InboxOnServer);

Object.freeze(exports);