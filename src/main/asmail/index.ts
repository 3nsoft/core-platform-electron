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

import { Duplex, RequestEnvelope }
	from '../../lib-common/ipc/electron-ipc';
import { asmail, IGetSigner } from '../../renderer/common';
import { InboxOnServer } from './inbox';
import { relyingParty as mid } from '../../lib-common/mid-sigs-NaCl-Ed';
import { JsonKey, SignedLoad } from '../../lib-common/jwkeys';
import { makeRuntimeException } from '../../lib-common/exceptions/runtime';
import { errWithCause } from '../../lib-common/exceptions/error';
import { KeyRing, makeKeyring, PublishedKeys } from './keyring';
import { FS } from '../../lib-client/3nstorage/xsp-fs/common';
import { MailSender } from '../../lib-client/asmail/sender';
import { getASMailServiceFor, getMailerIdInfoFor }
	from '../../lib-client/service-locator';
import * as confApi from '../../lib-common/service-api/asmail/config';
import { EncrDataBytes, MsgPacker, HEADERS } from '../../lib-client/asmail/msg';
import { ConfigOfASMailServer } from './config';
import { bind } from '../../lib-common/binding';
import { InboxCache, makeInboxCache } from './inbox-cache';
import { FS as DevFS } from '../../lib-client/local-files/device-fs';
import { makeInboxFS } from '../../lib-client/local-files/app-files';
import { toCanonicalAddress } from '../../lib-common/canonical-address';

const KEYRING_DATA_FOLDER = 'keyring';
const INBOX_DATA_FOLDER = 'inbox';
const CONFIG_DATA_FOLDER = 'config';

function extractAndVerifyPKey(address: string,
		certs: confApi.p.initPubKey.Certs, validAt: number,
		rootCert: SignedLoad, rootAddr: string): JsonKey {
	address = toCanonicalAddress(address);
	try {
		return mid.verifyPubKey(certs.pkeyCert, address,
			{ user: certs.userCert, prov: certs.provCert, root: rootCert },
			rootAddr, validAt);
	} catch (e) {
		return null;
	}
}

async function sendObj(mSender: MailSender, objId: string,
		bytes: EncrDataBytes): Promise<void> {
	let offset: number = null;
	async function sendHead(isFirst?: boolean): Promise<void> {
		if (isFirst) { offset = 0; }
		let chunkSize = Math.min(bytes.head.length-offset, mSender.maxChunkSize);
		let chunk = bytes.head.subarray(offset, offset+chunkSize);
		await mSender.sendObjHeadChunk(objId, offset, chunk,
			(isFirst ? bytes.head.length : null));
		offset += chunkSize;
		if (offset < bytes.head.length) {
			return sendHead();
		}
	}
	let segsLen = 0;
	for (let i=0; i<bytes.segs.length; i+=1) {
		segsLen += bytes.segs[i].length;
	}
	let segInd = 0;
	let posInSeg = 0;
	async function sendSegs(isFirst?: boolean): Promise<void> {
		if (segInd >= bytes.segs.length) { return; }
		if (isFirst) { offset = 0; }
		let chunk = new Uint8Array(Math.min(mSender.maxChunkSize, segsLen));
		let ofs = 0;
		let d: number;
		let seg: Uint8Array;
		while ((ofs < chunk.length) && (segInd < bytes.segs.length)) {
			seg = bytes.segs[segInd];
			d = seg.length - posInSeg;
			d = Math.min(d, chunk.length - ofs);
			chunk.set(seg.subarray(posInSeg, posInSeg+d), ofs);
			ofs += d;
			posInSeg += d;
			if (posInSeg === seg.length) {
				segInd += 1;
				posInSeg = 0;
			}
		}
		chunk = chunk.subarray(0, ofs);
		await mSender.sendObjSegsChunk(objId, offset, chunk,
			(isFirst ? segsLen : null));
		offset += ofs;
		if (offset < segsLen) {
			await sendSegs();
		}
	}
	await sendHead(true);
	await sendSegs(true);
}

function msgFromUIForm(msgToSend: Web3N.ASMail.OutgoingMessage): MsgPacker {
	let msg = new MsgPacker();
	if (msgToSend.plainTxtBody) {
		msg.setPlainTextBody(msgToSend.plainTxtBody);
	} else if (msgToSend.htmlTxtBody) {
		msg.setHtmlTextBody(msgToSend.htmlTxtBody);
	}
	if (msgToSend.subject) {
		msg.setHeader(HEADERS.SUBJECT, msgToSend.subject);
	}
	if (msgToSend.carbonCopy) {
		msg.setHeader(HEADERS.CC, msgToSend.carbonCopy);
	}
	if (msgToSend.recipients) {
		msg.setHeader(HEADERS.TO, msgToSend.recipients);
	}
	return msg;
}

const CACHE_DIR = 'cache';

export class ASMail {
	
	private uiSide: Duplex = null;
	private keyring: KeyRing = null;
	private address: string = null;
	private getSigner: IGetSigner = null;
	private inbox: InboxOnServer = null;
	private config: ConfigOfASMailServer = null;
	
	constructor() {
		Object.seal(this);
	}
	
	async init(address: string, getSigner: IGetSigner,
			asmailFS: FS): Promise<void> {
		try {
			this.address = address;
			this.getSigner = getSigner;
			let keyringFS = await asmailFS.makeSubRoot(KEYRING_DATA_FOLDER);
			this.keyring = await makeKeyring(keyringFS);
			await Promise.all([
				(async () => {
					let inboxFS = await asmailFS.makeSubRoot(INBOX_DATA_FOLDER);
					this.inbox = new InboxOnServer(this.address,
						this.getSigner, this.keyring, inboxFS);
					let inboxDevFS = await makeInboxFS(this.address);
					let cacheFS = await inboxDevFS.makeSubRoot(CACHE_DIR);
					let inboxCache = await makeInboxCache(cacheFS);
					await this.inbox.init(inboxCache);
				})(),
				(async () => {
					let confFS = await asmailFS.makeSubRoot(CONFIG_DATA_FOLDER)
					this.config = new ConfigOfASMailServer(this.address,
						new PublishedKeys(this.keyring), confFS, this.getSigner);
					await this.config.init();
				})()
			]);
			await asmailFS.close();
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize ASMail');
		}
	}
	
	attachTo(uiSide: Duplex): void {
		this.uiSide = uiSide;
		this.attachHandlersToUI();
	}
	
	private attachHandlersToUI(): void {
		let uiReqNames = asmail.uiReqNames;
		this.uiSide.addHandler(uiReqNames.sendPreFlight,
			bind(this, this.handleSendPreFlight));
		this.uiSide.addHandler(uiReqNames.sendMsg,
			bind(this, this.handleSendMsg));
		this.uiSide.addHandler(uiReqNames.listMsgs,
			bind(this, this.handleListMsgs));
		this.uiSide.addHandler(uiReqNames.removeMsg,
			bind(this, this.handleRemoveMsg));
		this.uiSide.addHandler(uiReqNames.getMsg,
			bind(this, this.handleGetMsg));
		this.uiSide.addHandler(uiReqNames.getUserId,
			bind(this, this.handleGetUserId));
	}
	
	private async handleGetUserId(): Promise<string> {
		return this.address;
	}
	
	// XXX reflow both message sending and preflight to exploit known
	//		info for setting sender and invite parameter(s)
	
	private async handleSendPreFlight(env: RequestEnvelope<string>):
			Promise<number> {
		// TODO check if sending can be done with sender === null
		let sender = this.address;
		let recipient = env.req;
		let inviteToken = this.keyring.getInviteForSendingTo(recipient);
		let mSender = (inviteToken ?
			new MailSender(sender, recipient, inviteToken) :
			new MailSender(sender, recipient));
		let serviceURL = await getASMailServiceFor(recipient)
		await mSender.setDeliveryUrl(serviceURL);
		await mSender.performPreFlight();
		return mSender.maxMsgLength;
	}
	
	private async handleSendMsg(env: RequestEnvelope<asmail.RequestSendMsg>):
			Promise<string> {
		let msgToSend = env.req.msg;
		let recipient = env.req.recipient;
		let msg = msgFromUIForm(msgToSend);
		// TODO check if sending can be done with sender === null
		let sender = this.address;
		let inviteToSendNow = this.keyring.getInviteForSendingTo(recipient);
		let mSender = (inviteToSendNow ?
			new MailSender(sender, recipient, inviteToSendNow) :
			new MailSender(sender, recipient));
		let serviceURL = await getASMailServiceFor(recipient);
		await mSender.setDeliveryUrl(serviceURL);
		
		// 1st request
		await mSender.startSession();
		
		// 2nd request, applicable only to authenticated sending
		if (sender) {
			let signer = await this.getSigner();
			await mSender.authorizeSender(signer);
		}
		
		let introPKeyFromServer: JsonKey = null; 
		
		// 3rd request, is needed only when recipient is not known
		if (!this.keyring.isKnownCorrespondent(mSender.recipient)) {
			let certs = await mSender.getRecipientsInitPubKey();
			// verify recipient's key certificates
			try {
				let data = await getMailerIdInfoFor(recipient)
				// TODO choose proper root certificate, as it may not be current
				let rootAddr = data.domain;
				let rootCert = data.info.currentCert;
				let now = Date.now() / 1000;
				let pkey = extractAndVerifyPKey(mSender.recipient, certs,
					now, rootCert, rootAddr);
				if (pkey) {
					introPKeyFromServer = pkey;
				} else {
					throw makeRuntimeException('recipientPubKeyFailsValidation');
				}
			} catch (err) {
				if (err.status == 474) {
					throw makeRuntimeException('recipientHasNoPubKey');
				} else {
					throw err;
				}
			}
		}
			
			
		let inviteForReplies =
			await this.config.getAnonSenderInviteFor(recipient);
		
		// encrypting message
		let msgCrypto = this.keyring.generateKeysForSendingTo(
			mSender.recipient, inviteForReplies, introPKeyFromServer);
		msg.setNextKeyPair(msgCrypto.pairs.next);
		if (msgCrypto.pairs.current.pid) {
			msg.setMetaForEstablishedKeyPair(msgCrypto.pairs.current.pid);
		} else {
			let signer = await this.getSigner()
			msg.setMetaForNewKey(
				msgCrypto.pairs.current.recipientKid,
				msgCrypto.pairs.current.senderPKey.k,
				signer.certifyPublicKey(
					msgCrypto.pairs.current.senderPKey, 30*24*60*60),
				signer.userCert, signer.providerCert);
		}
		let dataToSend = msg.encrypt(msgCrypto.encryptor);
		msgCrypto.encryptor.destroy();
		
		// sending metadata
		await mSender.sendMetadata(dataToSend.meta);
		
		// sending objects one-by-one in a chained fashion
		for (var i=0; i<dataToSend.meta.objIds.length; i+=1) {
			let objId = dataToSend.meta.objIds[i];
			await sendObj(mSender, objId, dataToSend.bytes[objId]);
		}
		
		// finalize delivery
		await mSender.completeDelivery();
		
		return mSender.msgId;
	}
	
	private async handleListMsgs(env: RequestEnvelope<number>):
			Promise<Web3N.ASMail.MsgInfo[]> {
		let fromTS = env.req;
		let msgInfos = await this.inbox.getMsgs(fromTS)
		return msgInfos;
	}
	
	private async handleRemoveMsg(env: RequestEnvelope<string>): Promise<void> {
		let msgId = env.req;
		await this.inbox.removeMsgUsingIdOnly(msgId);
	}
	
	private async handleGetMsg(env: RequestEnvelope<string>):
			Promise<Web3N.ASMail.IncomingMessage> {
		let msgId = env.req;
		let msg = await this.inbox.getMsg(msgId)
		return msg;
	}
	
	close(): void {
		this.keyring.saveChanges();
	}
	
}

Object.freeze(exports);