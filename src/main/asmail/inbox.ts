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

import { FS } from '../../lib-client/3nstorage/xsp-fs/common';
import { ConnectException, ConnectExceptionType }
	from '../../lib-common/exceptions/http';
import { errWithCause } from '../../lib-common/exceptions/error';
import { NamedProcs } from '../../lib-common/processes';
import { MailRecipient, makeMsgIsBrokenException, makeMsgNotFoundException }
	from '../../lib-client/asmail/recipient';
import { getASMailServiceFor, getMailerIdInfoFor }
	from '../../lib-client/service-locator';
import { MsgOpener, HEADERS } from '../../lib-client/asmail/msg';
import { KeyRing, DecryptorWithInfo } from './keyring';
import { IGetSigner } from '../../renderer/common';
import { InboxCache, MSG_STATUS as MSG_CACHE_STATUS } from './inbox-cache';
import { Exception as CacheException, ExceptionType as CacheExceptionType }
	from '../../lib-client/local-files/generational-cache';
import { MsgIndex } from './inbox-index';
import { makeCachedObjSource } from './cached-obj-source';

function msgToUIForm(msg: MsgOpener): Web3N.ASMail.IncomingMessage {
	let m: Web3N.ASMail.IncomingMessage = {
		sender: msg.sender.address,
		msgId: msg.msgId,
		deliveryTS: msg.meta.deliveryCompletion,
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
	return m;
}

/**
 * Instance of this class represents inbox-on-mail-server.
 * It uses api to manage messages on a ASMail server, caching and recording
 * some information to allow faster response, and to keep message keys, while
 * messages have not been removed via direct action or due to expiry.
 * This object is also responsible for expiring messages on the server.
 */
export class InboxOnServer {
	
	private index: MsgIndex;
	private msgReceiver: MailRecipient = null;
	private procs = new NamedProcs();
	private cache: InboxCache = null;
	
	constructor(
			private address: string,
			private getSigner: IGetSigner,
			private keyring: KeyRing,
			inboxFS: FS) {
		this.index = new MsgIndex(inboxFS);
		Object.seal(this);
	}
	
	/**
	 * @param cache is inbox cache, backed by device's file system
	 * @return a promise, resolvable when initialization completes.
	 * This object cannot be used prior to initialization completion.
	 */
	async init(cache: InboxCache): Promise<void> {
		try {
			this.cache = cache;
			await Promise.all([
				this.index.init(),
				this.setReceiver().catch((e: ConnectException) => {
					if (e.type !== ConnectExceptionType) { throw e; }
				})
			]);
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize Inbox');
		}
	}
	
	private async setReceiver(): Promise<void> {
		let msgReceiver = new MailRecipient(this.address, this.getSigner);
		let serviceURL = await getASMailServiceFor(this.address);
		await msgReceiver.setRetrievalUrl(serviceURL);
		await msgReceiver.login();
		this.msgReceiver = msgReceiver;
	}
	
	private async ensureReceiverIsSet(): Promise<void> {
		if (!this.msgReceiver) {
			await this.setReceiver();
		}
	}
	
	/**
	 * Removes message from a server, and cleans respective cache.
	 * @param msg is an info object with id and a timestamp of a message that
	 * should be removed/deleted
	 * @return a promise, resolvable when server completes message removal.
	 */
	removeMsg(msg: Web3N.ASMail.MsgInfo): Promise<void> {
		// check for an already started process
		let procId = 'removal of '+msg.msgId;
		let promise = this.procs.getP<void>(procId);
		if (promise) { return promise; }
		// start removal process
		return this.procs.start<void>(procId, (async () => {
			await this.ensureReceiverIsSet();
			await Promise.all([
				this.index.remove(msg),
				this.cache.deleteMsg(msg.msgId),
				this.msgReceiver.removeMsg(msg.msgId)
			]);
		}));
	}
	
	/**
	 * Removes message from a server, and cleans respective cache.
	 * @param msg is an id of a message that should be removed/deleted
	 * @return a promise, resolvable when server completes message removal.
	 */
	removeMsgUsingIdOnly(msgId: string): Promise<void> {
		// check for an already started process
		let procId = 'removal of '+msgId;
		let promise = this.procs.getP<void>(procId);
		if (promise) { return promise; }
		// start removal process
		return this.procs.start<any>(procId, (async () => {
			await this.ensureReceiverIsSet();
			await Promise.all([
				this.index.removeUsingIdOnly(msgId),
				this.cache.deleteMsg(msgId),
				this.msgReceiver.removeMsg(msgId)
			]);
		}));
	}
	
	private async cacheMsgMetaAndAddKeyToIndex(msgId: string): Promise<void> {
		// get meta from server
		let meta = await this.msgReceiver.getMsgMeta(msgId);
		
		// check, once again, if msg is already indexed
		let msgInfo: Web3N.ASMail.MsgInfo = {
			msgId,
			deliveryTS: meta.deliveryCompletion
		};
		let knownDecryptor = await this.index.getDecr(msgInfo);
		if (knownDecryptor) { return; }
		
		// check possible key pairs (respective decryptors)
		let msgDecr: DecryptorWithInfo = null;
		let decryptors = this.keyring.getDecryptorFor(meta.extMeta);
		if (!decryptors) { return this.msgReceiver.removeMsg(msgId); }
		let mainObjId = meta.extMeta.objIds[0];
		let header = await this.msgReceiver.getObjHead(msgId, mainObjId);
		let msgOpener = new MsgOpener(msgId, meta);
		try {
			for (let decr of decryptors) {
				try {
					msgOpener.setCrypto(decr, header);
					msgDecr = decr;
				} catch (err) {
					if (!(<any> err).failedCipherVerification) { throw err; }
				}
			}
		} finally {
			for (let decr of decryptors) {
				decr.decryptor.destroy();
			}
		}
		if (!msgDecr) { return this.msgReceiver.removeMsg(msgId); }
		
		// look inside main object either to get next crypto material, or to
		// get and verify sender's identity
		let segments = await this.msgReceiver.getObjSegs(msgId, mainObjId);
		// TODO add discrimination and corresponding handling of malformed main
		//		object, identity verification failure, and network error, which may
		//		disallow identity check at this moment.  
		if (msgOpener.sender.address) {
			// messages, with established key pairs, have sender known from
			//	keyring info, and we need to look for a next suggested key pair
			await msgOpener.setMain(segments);
			this.keyring.absorbSuggestedNextKeyPair(msgOpener.sender.address,
				msgOpener.getNextCrypto(), msgOpener.meta.deliveryStart);
		} else {
			// messages, with no sender info from a keyring, need sender's key and
			// identity verified, which is done by call below
			await msgOpener.setMain(segments, getMailerIdInfoFor);
			msgDecr.correspondent = msgOpener.sender.address;
			// Note: we do not record suggested crypto here.
			//		Reply to this message should pick up suggested next key pair,
			//		and record it in the keyring.
		}
		
		// add records to index and cache
		await this.index.add(
			{ msgId: msgId, deliveryTS: meta.deliveryCompletion }, msgDecr);
		await this.cache.startSavingMsg(msgId, meta);
		
		// cache main object, since all of its bytes are already here
		await this.cache.saveCompleteObj(msgId, mainObjId, header, segments);
	}
	
	getMsgs(fromTS: number, checkServer = true): Promise<Web3N.ASMail.MsgInfo[]> {
		// check for an already started process
		let procId = 'listing msgs';
		let promise = this.procs.getP<Web3N.ASMail.MsgInfo[]>(procId);
		if (promise) { return promise; }
		// start message listing process
		return this.procs.start(procId, async () => {
			// message listing info is located in index, yet, process involves
			// getting and caching messages' metadata
			if (checkServer) {
				let msgIds: string[];
				try {
					this.ensureReceiverIsSet();
					msgIds = await this.msgReceiver.listMsgs(fromTS);
				} catch (exc) {
					if ((<ConnectException> exc).type !== ConnectExceptionType) {
						throw exc; }
				}
				let indexedMsgs = await this.index.listMsgs(fromTS);
				for (let info of indexedMsgs) {
					let ind = msgIds.indexOf(info.msgId);
					if (ind >= 0) {
						msgIds.splice(ind, 1);
					}
				}
				if (msgIds.length === 0) { return indexedMsgs; }
				let keying: Promise<void>[] = [];
				for (let msgId of msgIds) {
					keying.push(this.cacheMsgMetaAndAddKeyToIndex(msgId).catch(
						(err) => {
							console.error('An error occured when getting message with id '+msgId);
							console.error(err);
						}));
				}
				await Promise.all(keying);
			}
			return this.index.listMsgs(fromTS);
		});
	}
	
	// Note: IncomingMessage will have a file system like, readonly access to
	//		attachments and/or other files. Therefore, all attached objects shall
	//		be loaded via that fs-like API, while IncomingMessage only requires
	//		loading of the 0-th object.
	
	getMsg(msgId: string): Promise<Web3N.ASMail.IncomingMessage> {
		let procId = 'get msg #'+msgId;
		let promise = this.procs.getP<Web3N.ASMail.IncomingMessage>(procId);
		if (promise) { return promise; }
		return this.procs.start(procId, async () => {
			
			let cacheInfo = await this.cache.getMsgStatus(msgId)
			.catch(async (exc: CacheException) => {
				// It is possible for message to be purged from a cache, in which
				// case we should try to get it from the server again
				if ((exc.type !== CacheExceptionType) || !exc.notFound) {
					throw exc;
				}
				await this.ensureReceiverIsSet();
				let meta = await this.msgReceiver.getMsgMeta(msgId);
				await this.cache.startSavingMsg(msgId, meta);
				return this.cache.getMsgStatus(msgId);
			});
			
			let meta = await this.cache.getMsgMeta(msgId);
			let msgInfo = {
				msgId,
				deliveryTS: meta.deliveryCompletion
			};
			
			if (cacheInfo.status === MSG_CACHE_STATUS.noMsgKey) {
				// message cannot be opened, and should've been removed
				await Promise.all([
					this.index.remove(msgInfo),
					this.cache.deleteMsg(msgId),
					this.msgReceiver.removeMsg(msgId).catch((exc) => {})
				]);
				throw makeMsgNotFoundException(msgId);
			}
			
			let mainObj = await makeCachedObjSource(this.msgReceiver, this.cache,
				msgId, meta.extMeta.objIds[0]);
			let decr = await this.index.getDecr(msgInfo);
			if (!decr) {
				await Promise.all([
					this.cache.deleteMsg(msgId),
					this.msgReceiver.removeMsg(msgId).catch((exc) => {})
				]);
				throw new Error('Missing key for a message.');
			}
			let msg = new MsgOpener(msgId, meta);
			try {
				let header = await mainObj.readHeader();
				msg.setCrypto(decr, header);
			} catch (err) {
				if ((<any> err).failedCipherVerification) {
					throw makeMsgIsBrokenException(msgId);
				} else {
					throw err;
				}
			} finally {
				decr.decryptor.destroy();
			}
			let bytes = await mainObj.segSrc.read(null);
			await msg.setMain(bytes);
			
			return msgToUIForm(msg);
		});
	}
	
}
Object.freeze(InboxOnServer.prototype);
Object.freeze(InboxOnServer);

Object.freeze(exports);