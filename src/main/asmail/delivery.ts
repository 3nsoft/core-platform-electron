/*
 Copyright (C) 2016 3NSoft Inc.
 
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
import { FS } from '../../lib-client/3nstorage/xsp-fs/common';
import { NamedProcs } from '../../lib-common/processes';
import { getASMailServiceFor } from '../../lib-client/service-locator';
import { KeyRing } from './keyring';
import { IGetSigner, asmail } from '../../renderer/common';
import { bind } from '../../lib-common/binding';
import { JsonKey } from '../../lib-common/jwkeys';
import { makeRuntimeException } from '../../lib-common/exceptions/runtime';
import { MailSender, EXCEPTION_TYPE } from '../../lib-client/asmail/sender';
import { MsgPacker, HEADERS, SendReadyForm } from '../../lib-client/asmail/msg';
import { ProxiedObjGetter } from '../proxied-objs/fs';
import { Container } from '../../lib-client/asmail/attachments/container'
import { ObjSource } from '../../lib-common/obj-streaming/common';
import { defer, Deferred, SingleProc } from '../../lib-common/processes';
import { checkAndExtractPKey } from './key-verification';
import * as confApi from '../../lib-common/service-api/asmail/config';

type OutgoingMessage = web3n.asmail.OutgoingMessage;
type AttachmentsContainer = web3n.asmail.AttachmentsContainer;
type DeliveryProgress = web3n.asmail.DeliveryProgress;

const SMALL_MSG_SIZE = 1024*1024;

async function msgFromUIForm(msgToSend: OutgoingMessage, sender: string,
		attachments?: { container?: AttachmentsContainer; fs?: FS }):
		Promise <MsgPacker> {
	let msg = new MsgPacker();
	msg.setHeader(HEADERS.FROM, sender);
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
	if (attachments) {
		await msg.setAttachments(attachments.container, attachments.fs);
	}
	return msg;
}

class ResourcesForSending {
	
	constructor(
			public address: string,
			public getSigner: IGetSigner,
			public keyring: KeyRing,
			public invitesForAnonReplies: (address: string) => string) {
		Object.seal(this);
	}
	
}

/**
 * Instance of this class represents a work in progress for sending a given
 * message to a given recipient.
 * It has a simple method to do next action, while keeping track of a progress,
 * and updating respective info elements that are used for notifications.
 */
class WIP {

	private stage: "1-start-session" | "2-opt-auth" |
		"3-get-pk" | "4-send-meta" | "5-send-objs" |
		"cancel" = "1-start-session";
	proc = new SingleProc<void>();
	private sender: MailSender = (undefined as any);
	private dataToSend: SendReadyForm = (undefined as any);
	private objUpload: {
		indexInMeta: number;
		objId: string;
		headerDone: boolean;
		src: ObjSource;
		offset: number;
	} = (undefined as any);

	constructor(
			private r: ResourcesForSending,
			public id: string,
			public info: DeliveryProgress,
			private msg: MsgPacker,
			private recipient: string) {
		if (!this.info.recipients[recipient]) { throw new Error(
			`Recipient ${recipient} is not present in the info object ${JSON.stringify(this.info)}`); }
		Object.seal(this);
	}

	isDone(): boolean {
		return (this.stage === undefined);
	}

	/**
	 * @return a promise for a newly started phase.
	 * If an action is ongoing, or if this wip is done, undefined is returned.
	 */
	startNext(): Promise<void>|undefined {
		let proc = this.proc.getP();
		if (proc) { return; }
		if (this.stage === "1-start-session") {
			proc = this.proc.addStarted(this.startSession());
		} else if (this.stage === "2-opt-auth") {
			proc = this.proc.addStarted(this.authSender());
		} else if (this.stage === "3-get-pk") {
			proc = this.proc.addStarted(this.getRecipientKeyAndEncrypt());
		} else if (this.stage === "4-send-meta") {
			proc = this.proc.addStarted(this.sendMeta());
		} else if (this.stage === "5-send-objs") {
			proc = this.proc.addStarted(this.sendObjs());
		} else if (this.stage === "cancel") {
			proc = this.proc.addStarted(this.cancelSending());
		} else if (this.stage === undefined) {
			return;
		} else {
			throw new Error(`Unknown wip stage ${this.stage}`);
		}
		return proc.catch((err) => {
			this.updateInfo(0, true, err);
			this.stage = (undefined as any);
		});
	}

	async cancel(): Promise<void> {
		this.stage = "cancel";

		// XXX

	}

	private async startSession(): Promise<void> {

		// TODO check if sending can be done with sender === null

		let senderAddress = this.r.address;
		let inviteToSendNow = this.r.keyring.getInviteForSendingTo(this.recipient);
		this.sender = (inviteToSendNow ?
			new MailSender(senderAddress, this.recipient, inviteToSendNow) :
			new MailSender(senderAddress, this.recipient));
		let serviceURL = await getASMailServiceFor(this.recipient);
		await this.sender.setDeliveryUrl(serviceURL);
		
		await this.sender.startSession();
		
		if (this.stage === "cancel") { return; }
		if (this.sender.sender) {
			this.stage = "2-opt-auth";
		} else {
			this.stage = "3-get-pk";
		}
	}

	private async authSender(): Promise<void> {
		let signer = await this.r.getSigner();
		await this.sender.authorizeSender(signer);
		if (this.stage !== "cancel") {
			this.stage = "3-get-pk";
		}
	}

	private async getRecipientKeyAndEncrypt(): Promise<void> {
		
		let introPKeyFromServer: JsonKey|undefined = undefined; 
		
		// 3rd request, is needed only when recipient is not known
		if (!this.r.keyring.isKnownCorrespondent(this.sender.recipient)) {
			let certs = await this.sender.getRecipientsInitPubKey();
			try {
				introPKeyFromServer = await checkAndExtractPKey(
					this.sender.recipient, certs);
			} catch (err) {
				throw makeRuntimeException(
					'recipientPubKeyFailsValidation', EXCEPTION_TYPE, err);
			}
		}
			
		let inviteForReplies = await this.r.invitesForAnonReplies(
			this.sender.recipient);
		
		// encrypting message
		let msgCrypto = this.r.keyring.generateKeysForSendingTo(
			this.sender.recipient, inviteForReplies, introPKeyFromServer);
		this.msg.setNextKeyPair(msgCrypto.pairs.next);
		if (msgCrypto.pairs.current.pid) {
			this.msg.setMetaForEstablishedKeyPair(msgCrypto.pairs.current.pid);
		} else {
			let signer = await this.r.getSigner();
			let pkCerts: confApi.p.initPubKey.Certs = {
				pkeyCert: signer.certifyPublicKey(
					msgCrypto.pairs.current.senderPKey!, 30*24*60*60),
				userCert: signer.userCert,
				provCert: signer.providerCert
			};
			this.msg.setMetaForNewKey(
				msgCrypto.pairs.current.recipientKid!,
				msgCrypto.pairs.current.senderPKey!.k,
				pkCerts);
		}
		this.dataToSend = await this.msg.pack(msgCrypto.encryptor);
		msgCrypto.encryptor.destroy();

		// adjust size in info to be packed size
		this.info.msgSize = Math.max(this.info.msgSize, this.dataToSend.totalLen);

		// ensure message size is acceptable
		this.sender.ensureMsgFitsLimits(this.dataToSend.totalLen);

		if (this.stage !== "cancel") {
			this.stage = "4-send-meta";
		}
	}

	private updateInfo(bytesSent: number, complete = false, err?: any): void {
		let recInfo = this.info.recipients[this.recipient];
		if (complete) {
			if (err) {
				recInfo.err = err;
			} else {
				recInfo.bytesSent = this.info.msgSize;
			}
			recInfo.done = true;
		} else {
			recInfo.bytesSent += bytesSent;
		}
	}

	private async sendMeta(): Promise<void> {
		await this.sender.sendMetadata(this.dataToSend.meta);
		this.info.recipients[this.recipient].idOnDelivery = this.sender.msgId;
		if (this.stage !== "cancel") {
			this.stage = "5-send-objs";
		}
	}

	/**
	 * This sends only a chunk of an object, or switches to the next object, or
	 * completes  sending altogether.
	 */
	private async sendObjs(): Promise<void> {

		if (!this.objUpload) {
			// setup to send the first (main) object
			let objId = this.dataToSend.meta.objIds[0];
			this.objUpload = {
				headerDone: false,
				indexInMeta: 0,
				objId,
				src: await this.dataToSend.objSrc(objId),
				offset: 0
			};
		}

		if (!this.objUpload.headerDone) {
			// send object's header
			let objId = this.objUpload.objId;
			let h = await this.objUpload.src.readHeader();
			let headerOffset = 0;
			while (headerOffset < h.length) {
				let chunkLen = Math.min(
					h.length - headerOffset, this.sender.maxChunkSize);
				let chunk = h.subarray(headerOffset, headerOffset+chunkLen);
				let totalSizeParam = ((headerOffset === 0) ?
					h.length : undefined);
				await this.sender.sendObjHeadChunk(
					objId, headerOffset, chunk, totalSizeParam);
				headerOffset += chunkLen;
			}
			this.objUpload.headerDone = true;
			this.updateInfo(h.length);
			return;
		}

		let chunk = await this.objUpload.src.segSrc.read(
			this.sender.maxChunkSize);
		if (chunk) {
			// send object chunk
			let objId = this.objUpload.objId;
			let offset = this.objUpload.offset;
			let totalSizeParam = ((offset === 0) ?
				await this.objUpload.src.segSrc.getSize() : undefined);
			await this.sender.sendObjSegsChunk(
				objId, offset, chunk, totalSizeParam);
			this.objUpload.offset += chunk.length;
			this.updateInfo(chunk.length);
			return;
		}

		this.objUpload.indexInMeta += 1;
		if (this.objUpload.indexInMeta < this.dataToSend.meta.objIds.length) {
			// setup to deliver next object in the message
			let objId = this.dataToSend.meta.objIds[this.objUpload.indexInMeta];
			this.objUpload = {
				headerDone: false,
				indexInMeta: this.objUpload.indexInMeta,
				objId,
				src: await this.dataToSend.objSrc(objId),
				offset: 0
			};
		} else {
			// finalize delivery and declare completion
			await this.sender.completeDelivery();
			this.updateInfo(0, true);
			this.stage = (undefined as any);
			this.objUpload = (undefined as any);
			this.dataToSend = (undefined as any);
			this.sender = (undefined as any);
		}

	}

	private async cancelSending(): Promise<void> {

		// XXX  send something, if needed, and cleanup

		this.stage = (undefined as any);
	}

}

export class DeliveryService {

	private uiSide: Duplex = (undefined as any);
	private proxiedObjs: ProxiedObjGetter = (undefined as any);
	private r: ResourcesForSending;

	/**
	 * This is a container for all messages, added for delivery.
	 * Some of these can be done, some can still be in a sending process.
	 */
	private msgs = new Map<string, {msg: MsgPacker; info: DeliveryProgress;}>();

	/**
	 * This is a container for objects that should be resolved when a 
	 * respective message delivery completes.
	 */
	private deferreds = new Map<string, Deferred<DeliveryProgress>>();

	/**
	 * This is an ordered queue with ids for messages that should be sent
	 * one-by-one, cause they are big, and should generally yield to smaller
	 * messages.
	 */
	private queuedDelivery: string[] = [];

	/**
	 * These are deliveries that should go without waiting.
	 */
	private immediateWIPs = new Map<string, WIP[]>();

	/**
	 * This a queued piece that is being sent.
	 */
	private queuedWIP: WIP = (undefined as any);
	
	constructor(address: string, getSigner: IGetSigner, keyring: KeyRing,
			invitesForAnonReplies: (address: string) => string) {
		this.r = new ResourcesForSending(
			address, getSigner, keyring, invitesForAnonReplies);
		Object.seal(this);
	}
	
	attachTo(uiSide: Duplex, proxiedObjs: ProxiedObjGetter): void {
		this.uiSide = uiSide;
		this.proxiedObjs = proxiedObjs;
		this.attachHandlersToUI();
	}
	
	private attachHandlersToUI(): void {
		let deliveryNames = asmail.uiReqNames.delivery;
		this.uiSide.addHandler(deliveryNames.sendPreFlight,
			bind(this, this.handleSendPreFlight));
		this.uiSide.addHandler(deliveryNames.addMsg,
			bind(this, this.handleAddMsg));
		this.uiSide.addHandler(deliveryNames.listMsgs,
			bind(this, this.handleListMsgs));
		this.uiSide.addHandler(deliveryNames.completionOf,
			bind(this, this.handleCompletionOf));
		this.uiSide.addHandler(deliveryNames.rmMsg,
			bind(this, this.handleRemoveMsg));
		this.uiSide.addHandler(deliveryNames.currentState,
			bind(this, this.handleCurrentState));
	}

	async init(): Promise<void> {}
	
	private async handleSendPreFlight(env: RequestEnvelope<string>):
			Promise<number> {
		// TODO check if sending can be done with sender === null
		let sender = this.r.address;
		let recipient = env.req;
		let inviteToken = this.r.keyring.getInviteForSendingTo(recipient);
		let mSender = (inviteToken ?
			new MailSender(sender, recipient, inviteToken) :
			new MailSender(sender, recipient));
		let serviceURL = await getASMailServiceFor(recipient)
		await mSender.setDeliveryUrl(serviceURL);
		await mSender.performPreFlight();
		return mSender.maxMsgLength;
	}

	private async msgPackerFor(msgToSend: OutgoingMessage,
			attachments: asmail.AttachmentsContainer|undefined,
			attachmentsFS: string|undefined): Promise<MsgPacker> {
		if (attachments) {
			let c = new Container();
			for (let fName of Object.keys(attachments.files)) {
				let fileId = attachments.files[fName];
				let f = this.proxiedObjs.getFile(fileId);
				if (!f) { throw new Error(
					`Cannot find file ${fName} for attachment.`); }
				c.addFile(f, fName);
			}
			for (let fName of Object.keys(attachments.folders)) {
				let fsId = attachments.folders[fName];
				let fs = this.proxiedObjs.getFS(fsId);
				if (!fs) { throw new Error(
					`Cannot find folder ${fName} for attachment.`); }
				c.addFolder(fs, fName);
			}
			if ((c.getAllFiles().size > 0) || (c.getAllFolders().size > 0)) {
				return await msgFromUIForm(msgToSend, this.r.address, { container: c });
			}
		} else if (attachmentsFS) {
			let fs = this.proxiedObjs.getFS(attachmentsFS);
			if (fs) {
				return await msgFromUIForm(msgToSend, this.r.address, { fs });
			}
		}
		return await msgFromUIForm(msgToSend, this.r.address);
	}
	
	private async handleAddMsg(env: RequestEnvelope<asmail.RequestAddMsgToSend>):
			Promise<void> {
		let msgToSend = env.req.msg;
		let id = env.req.id;
		let sendImmediately = env.req.sendImmediately;
		let recipients = env.req.recipients;
		let attachments = env.req.attachments;
		let attachmentsFS = env.req.attachmentsFS;
		
		if (this.msgs.has(id)) { throw new Error(
			`Message with id ${id} has already been added for delivery`); }
		if (!Array.isArray(recipients) || (recipients.length === 0)) {
			throw new Error(`Given invalid recipients: ${recipients} for message ${id}`); }

		let msg = await this.msgPackerFor(msgToSend, attachments, attachmentsFS);
		let info: DeliveryProgress = {
			allDone: false,
			msgSize: await msg.sizeBeforePacking(),
			recipients: {}
		};
		for (let address of recipients) {
			info.recipients[address] = {
				done: false,
				bytesSent: 0
			};
		}
		this.msgs.set(id, { msg, info });

		if (sendImmediately ||
				((info.msgSize * recipients.length) <= SMALL_MSG_SIZE)) {
			this.startImmediateDelivery(id);
		} else {
			this.queuedDelivery.push(id);
			this.startQueuedDelivery();
		}
	}

	private startQueuedDelivery(): void {

		// do nothing, if immediate delivery takes place
		if (this.immediateWIPs.size > 0) { return; }

		// continue queued work in progress, if it is present
		if (this.queuedWIP) {
			this.continueQueuedWIP();
			return;
		}

		// quit when there is nothing queued
		if (this.queuedDelivery.length === 0) { return; }
		
		let id = this.queuedDelivery[0];
		let m = this.msgs.get(id);
		if (!m) { throw new Error(`Missing message for queued id ${id}`); }

		try {
			// look for a recipient, to who delivery is not done
			let recipient: string = (undefined as any);
			for (let address of Object.keys(m.info.recipients)) {
				let recInfo = m.info.recipients[address];
				if (!recInfo.done) {
					recipient = address;
					break;
				}
			}

			// setup wip and trigger its execution
			if (recipient) {
				this.queuedWIP = new WIP(this.r, id, m.info, m.msg, recipient);
				this.continueQueuedWIP();
				return;
			}

			// at this point message has been sent to all recipients, i.e. its done
			m.info.allDone = true;
			this.notifyOfProgress(id, m.info, true);
		} catch (err) {
			m.info.allDone = true;
			this.notifyOfProgress(id, m.info, true, err);
		}
		this.queuedDelivery.shift();

		// loop
		this.startQueuedDelivery();
	}

	private async continueQueuedWIP(): Promise<void> {
		let work = this.queuedWIP.startNext();
		if (!work) { return; }
		await work;
		this.notifyOfProgress(this.queuedWIP.id, this.queuedWIP.info);
		if (this.queuedWIP.isDone()) {
			this.queuedWIP = (undefined as any);
		}
		this.startQueuedDelivery();
	}

	/**
	 * @param id of a message to set for immediate delivery
	 */
	private startImmediateDelivery(id: string): void {
		let m = this.msgs.get(id);
		if (!m || m.info.allDone) { throw new Error(
			`No incomplete message with id ${id}`); }
		let { msg, info } = m;

		// set WIPs for immediate delivery
		let wips: WIP[] = [];
		for (let recipient of Object.keys(info.recipients)) {
			wips.push(new WIP(this.r, id, info, msg, recipient));
		}
		if (wips.length === 0) { throw new Error(
			`No recipients for message ${id}. Info: ${JSON.stringify(info)}`); }
		this.immediateWIPs.set(id, wips);

		// consequently sent message to all recipients
		this.doImmediateDeliveryOf(id);
	}

	/**
	 * This implementation does consequent sending of a message to all
	 * recipients.
	 * @param id of a message in immediate delivery
	 * @return a promise, but it shouldn't be waited on.
	 */
	private async doImmediateDeliveryOf(id: string): Promise<void> {
		let wips = this.immediateWIPs.get(id)!;
		let info = this.msgs.get(id)!.info;
		try {
			for (let wip of wips) {
				while (!wip.isDone()) {
					await wip.startNext();
					this.notifyOfProgress(id, wip.info);
				}
			}
			info.allDone = true;
			this.notifyOfProgress(id, info, true);
		} catch (err) {
			info.allDone = true;
			this.notifyOfProgress(id, info, true, err);
		} finally {
			this.immediateWIPs.delete(id);
		}
		this.startQueuedDelivery();
	}

	private async handleListMsgs(env: RequestEnvelope<void>):
			Promise<{ id: string; info: DeliveryProgress; }[]> {
		let lst: { id: string; info: DeliveryProgress; }[] = [];
		for (let entry of this.msgs.entries()) {
			lst.push({
				id: entry[0],
				info: entry[1].info
			});
		}
		return lst;
	}

	private notifyOfProgress(id: string, info: DeliveryProgress,
			complete = false, err?: any): void {
		let progrChan = asmail.eventChannels.deliveryProgress;
		let event: asmail.DeliveryProgressEvent = {
			id,
			p: info
		};
		this.uiSide.sendOutboundEvent(progrChan, event);
		if (complete) {
			let deferred = this.deferreds.get(id);
			if (deferred) {
				this.deferreds.delete(id);
				if (err) { deferred.reject(err); }
				else { deferred.resolve(info); }
			}
		}
	}

	private async handleCompletionOf(env: RequestEnvelope<string>):
			Promise<DeliveryProgress|undefined> {
		let id = env.req;
		let m = this.msgs.get(id);
		if (!m) { return; }
		if (m.info.allDone) { return m.info; }
		let deferred = this.deferreds.get(id);
		if (!deferred) {
			deferred = defer<DeliveryProgress>();
			this.deferreds.set(id, deferred);
		}
		return deferred.promise;
	}

	private async handleRemoveMsg(
			env: RequestEnvelope<asmail.RequestRmMsgFromSending>): Promise<void> {
		let id = env.req.id;
		let cancelSending = env.req.cancelSending;
		let m = this.msgs.get(id);
		if (!m) { return; }
		if (!cancelSending && !m.info.allDone) { throw new Error(
			`Cannot remove message ${id}, cause sending is not complete.`); }
		if (!m.info.allDone) {
			if ((this.queuedWIP && (this.queuedWIP.id === id)) ||
					this.immediateWIPs.has(id)) {
				throw new Error(`Canceling already sending message is not implemented, yet.`);
			}
			let ind = this.queuedDelivery.indexOf(id);
			if (ind >= 0) {
				this.queuedDelivery.splice(ind, 1);
			}
			let deferred = this.deferreds.get(id);
			deferred!.resolve(m.info);
		}
		this.msgs.delete(id);
		this.deferreds.delete(id);
	}

	private async handleCurrentState(env: RequestEnvelope<string>):
			Promise<DeliveryProgress|undefined> {
		let id = env.req;
		let m = this.msgs.get(id);
		if (!m) { return; }
		return m.info;
	}

}
Object.freeze(DeliveryService.prototype);
Object.freeze(DeliveryService);

Object.freeze(exports);