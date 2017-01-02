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

import { stringOfB64UrlSafeChars, uint48 } from '../../lib-client/random-node';
import { sleep } from '../../lib-common/processes';
import { bind } from '../../lib-common/binding';
import { makeInboxFS, makeStorageFS } from './mock-files';
import { FS } from '../../lib-client/local-files/device-fs';
import { makeRuntimeException } from '../../lib-common/exceptions/runtime';
import { errWithCause } from '../../lib-common/exceptions/error';
import { FileException } from '../../lib-common/exceptions/file';
import { toCanonicalAddress } from '../../lib-common/canonical-address';
import { utf8 } from '../../lib-common/buffer-utils';
import { defer, Deferred } from '../../lib-common/processes';
import { pipe } from '../../lib-common/byte-streaming/pipe';
import { toStorageFS } from './storage';
import { Container } from '../../lib-client/asmail/attachments/container';

export interface ASMailUserConfig {
	address: string;
	defaultMsgSize?: number;
	inboxIsFull?: boolean;
}

export interface ASMailMockConfig {
	existingUsers?: ASMailUserConfig[];
	knownDomains?: string[];
	misconfiguredDomains?: string[];
	network: {
		latencyMillis?: number;
		downSpeedKBs?: number;
		upSpeedKBs?: number;
	};
}

const EXCEPTION_TYPE = 'service-locating';

type ServLocException = web3n.asmail.ServLocException;
type ASMailSendException = web3n.asmail.ASMailSendException;
type InboxException = web3n.asmail.InboxException;

function makeDomainException(flag: string, address?: string): ServLocException {
	let exc = <ServLocException> makeRuntimeException(
		flag, EXCEPTION_TYPE);
	if (address) {
		exc.address = address;
	}
	return exc;
}

function domainNotFoundExc(address?: string): ServLocException {
	return makeDomainException('domainNotFound', address);
}

function noServiceRecordExc(address?: string): ServLocException {
	return makeDomainException('noServiceRecord', address);
}

function makeDeliveryException(flag: string, recipient: string):
		ASMailSendException {
	let exc = <ASMailSendException> makeRuntimeException(
		flag, 'asmail-delivery');
	exc.address = recipient;
	return exc;
}

function badRedirectExc(recipient: string): ASMailSendException {
	return makeDeliveryException('badRedirect', recipient);
}

function unknownRecipientExc(recipient: string): ASMailSendException {
	return makeDeliveryException('unknownRecipient', recipient);
}

function msgTooBigExc(recipient: string, allowedSize: number):
		ASMailSendException {
	let exc = makeDeliveryException('msgTooBig', recipient);
	exc.allowedSize = allowedSize;
	return exc;
}

function senderNotAllowedExc(recipient: string): ASMailSendException {
	return makeDeliveryException('senderNotAllowed', recipient);
}

function inboxIsFullExc(recipient: string): ASMailSendException {
	return makeDeliveryException('inboxIsFull', recipient);
}

function authFailedOnDeliveryExc(recipient: string): ASMailSendException {
	return makeDeliveryException('authFailedOnDelivery', recipient);
}

function makeInboxException(flag: string, msgId: string): InboxException {
	let exc = <InboxException> makeRuntimeException(
		flag, 'inbox');
	exc.msgId = msgId;
	return exc;
}

function makeMsgNotFoundException(msgId: string): InboxException {
	return makeInboxException('msgNotFound', msgId);
}

function makeObjNotFoundException(msgId: string, objId: string):
		InboxException {
	let exc = makeInboxException('objNotFound', msgId);
	exc.objId = objId;
	return exc;
}

function makeMsgIsBrokenException(msgId: string): InboxException {
	return makeInboxException('msgIsBroken', msgId);
}

const MSGS_FOLDER = 'msgs';
const MAIN_MSG_OBJ = 'main.json';
const ATTACHMENTS_FOLDER = 'attachments';

const DEFAULT_MSG_SIZE = 500*1024*1024;
const MSG_ID_LEN = 24;

type OutgoingMessage = web3n.asmail.OutgoingMessage;
type IncomingMessage = web3n.asmail.IncomingMessage;
type MsgInfo = web3n.asmail.MsgInfo;
type DeliveryProgress = web3n.asmail.DeliveryProgress;
type DeliveryService = web3n.asmail.DeliveryService;
type ASMailService = web3n.asmail.Service;
type AttachmentsContainer = web3n.asmail.AttachmentsContainer;
type InboxService = web3n.asmail.InboxService;

function domainOfCanonicalAddr(cAddr: string): string {
	let d = cAddr.substring(cAddr.indexOf('@')+1);
	if (!d) { throw new Error(`Given address ${cAddr} is malformed`); }
	return d;
}

async function getFolderContentSize(fs: FS, folderPath: string):
		Promise<number> {
	let size = 0;
	let lst = await fs.listFolder(folderPath);
	for (let f of lst) {
		if (f.isFile) {
			let stats = await fs.statFile(f.name);
			size += stats.size;
		} else if (f.isFolder) {
			size += await getFolderContentSize(fs, `${folderPath}/${f.name}`);
		}
	}
	return size;
}

async function getMsgSize(msg: OutgoingMessage): Promise<number> {
	let main = JSON.stringify(msg, (k, v) => {
		if (k === 'attachments') { return undefined; }
		else { return v; }
	});
	let msgSize = utf8.pack(main).length;
	if (msg.attachments) {
		let attachments = msg.attachments.getAllFiles();
		if (attachments.size > 0) {
			msgSize += 80*attachments.size;
			for (let f of attachments.values()) {
				let src = await f.getByteSource();
				let fSize = await src.getSize();
				if (fSize === null) { throw new Error(
					'Stream from file does not have size information'); }
				msgSize += fSize;
			}
		}
	} else if (msg.attachmentsFS) {
		let lst = await msg.attachmentsFS.listFolder('');
		for (let f of lst) {
			if (f.isFile) {
				let stats = await msg.attachmentsFS.statFile(f.name);
				msgSize += stats.size;
			} else if (f.isFolder) {
				msgSize += await getFolderContentSize(msg.attachmentsFS, f.name);
			}
		}
	}
	return msgSize;
}

abstract class ServiceWithInitPhase {

	protected initializing = defer<void>();

	protected async delayRequest(millis?: number): Promise<void> {
		if (this.initializing) { await this.initializing.promise; }
		if (typeof millis === 'number') {
			await sleep(millis);
		} else {
			await sleep(0);
		}
	}

}
Object.freeze(ServiceWithInitPhase.prototype);
Object.freeze(ServiceWithInitPhase);

const ASMAIL_CORE_APP = 'computer.3nweb.core.asmail';

interface ProgressCB {
	(p: DeliveryProgress): void;
}

interface MsgAndInfo {
	msg: OutgoingMessage;
	info: DeliveryProgress;
}

const SMALL_MSG_SIZE = 1024*1024;
const MAX_SENDING_CHUNK = 512*1024;

class DeliveryMock extends ServiceWithInitPhase implements DeliveryService {
	
	private userId: string = (undefined as any);
	private existingUsers = new Map<string, ASMailUserConfig>();
	private knownDomains = new Set<string>();
	private misconfiguredDomains = new Set<string>();
	private latencyMillis = 100;
	private downSpeedKBs = 500;
	private upSpeedKBs = 50;
	private fs: FS = (undefined as any);
	private msgs = new Map<string, MsgAndInfo>();
	private deliveryQueue: string[] = [];
	private sendingNow = new Set<string>();
	private callbacks = new Map<number, ProgressCB>();
	private progressCBs = new Map<string, number[]>();
	private deferreds = new Map<string, Deferred<DeliveryProgress>[]>();
	
	constructor() {
		super();
		Object.seal(this);
	}
	
	async initFor(userId: string, config: ASMailMockConfig):
			Promise<void> {
		try {
			this.userId = userId;
			if (config.network.latencyMillis) {
				this.latencyMillis = config.network.latencyMillis;
			}
			if (config.network.downSpeedKBs) {
				this.downSpeedKBs = config.network.downSpeedKBs;
			}
			if (config.network.upSpeedKBs) {
				this.upSpeedKBs = config.network.upSpeedKBs;
			}
			if (config.network.latencyMillis) {
				this.latencyMillis = config.network.latencyMillis;
			}
			if (Array.isArray(config.knownDomains)) {
				for (let d of config.knownDomains) {
					this.knownDomains.add(d);
				}
			}
			if (Array.isArray(config.misconfiguredDomains)) {
				for (let d of config.misconfiguredDomains) {
					this.misconfiguredDomains.add(d);
				}
			}
			if (Array.isArray(config.existingUsers)) {
				for (let settings of config.existingUsers) {
					settings.address = toCanonicalAddress(settings.address);
					this.existingUsers.set(settings.address, settings);
					this.knownDomains.add(domainOfCanonicalAddr(settings.address));
				}
			}
			let appFS = await makeStorageFS(this.userId);
			this.fs = await appFS.writableSubRoot(`Apps Data/${ASMAIL_CORE_APP}/delivery`);
			this.initializing.resolve();
			this.initializing = (undefined as any);
		} catch (e) {
			e = errWithCause(e, 'Mock of ASMail delivery failed to initialize');
			this.initializing.reject(e);
			throw e;
		}
	}
	
	private firstStageOfMsgSending(toAddress: string): number {
		let cAddr = toCanonicalAddress(toAddress);
		let domain = domainOfCanonicalAddr(cAddr);
		if (!this.knownDomains.has(domain)) {
			throw domainNotFoundExc(toAddress);
		}
		if (this.misconfiguredDomains.has(domain)) {
			throw noServiceRecordExc(toAddress);
		}
		let recipient = this.existingUsers.get(cAddr);
		if (!recipient) {
			throw unknownRecipientExc(toAddress);
		} else if (recipient.inboxIsFull) {
			throw inboxIsFullExc(toAddress);
		} else {
			return ((typeof recipient.defaultMsgSize === 'number') ?
				recipient.defaultMsgSize : DEFAULT_MSG_SIZE);
		}
	}
	
	async preFlight(toAddress: string): Promise<number> {
		await this.delayRequest();
		await sleep(Math.floor(this.latencyMillis/2));
		return this.firstStageOfMsgSending(toAddress);
	}
	
	private async saveMsgToRecipientData(recipient: string,
			msg: OutgoingMessage): Promise <string> {
		let inMsg = this.toIncomingMsg(msg);
		let recipientInbox = await makeInboxFS(recipient);
		let recipientMsgs = await recipientInbox.writableSubRoot(MSGS_FOLDER);
		async function makeMsgFS(): Promise<web3n.files.FS> {
			try {
				await recipientMsgs.makeFolder(inMsg.msgId, true);
				return recipientMsgs.writableSubRoot(inMsg.msgId);
			} catch(e) {
				if (!(<web3n.files.FileException> e).alreadyExists) { throw e; }
				inMsg.msgId = stringOfB64UrlSafeChars(MSG_ID_LEN);
				return makeMsgFS();
			}
		}
		let msgFS = await makeMsgFS();
		await msgFS.writeJSONFile(MAIN_MSG_OBJ, inMsg);
		if (msg.attachments) {
			for (let nameAndFile of msg.attachments.getAllFiles().entries()) {
				let name = nameAndFile[0];
				let f = nameAndFile[1];
				await msgFS.saveFile(f, `${ATTACHMENTS_FOLDER}/${name}`);
			}
			for (let nameAndFS of msg.attachments.getAllFolders().entries()) {
				let name = nameAndFS[0];
				let f = nameAndFS[1];
				await msgFS.saveFolder(f, `${ATTACHMENTS_FOLDER}/${name}`);
			}
		} else if (msg.attachmentsFS) {
			let lst = await msg.attachmentsFS.listFolder('');
			if (lst.length > 0) {
				await msgFS.saveFolder(msg.attachmentsFS, ATTACHMENTS_FOLDER, true);
			}
		}
		return inMsg.msgId;
	}
	
	private toIncomingMsg(msg: OutgoingMessage): IncomingMessage {
		let inMsg = <IncomingMessage> {
			msgId: stringOfB64UrlSafeChars(MSG_ID_LEN),
			deliveryTS: Date.now(),
			sender: this.userId
		};
		if (msg.subject) { inMsg.subject = msg.subject; }
		if (msg.msgType) { inMsg.msgType = msg.msgType; }
		if (msg.chatId) { inMsg.chatId = msg.chatId; }
		if (msg.plainTxtBody) { inMsg.plainTxtBody = msg.plainTxtBody; }
		if (msg.htmlTxtBody) { inMsg.htmlTxtBody = msg.htmlTxtBody; }
		if (msg.carbonCopy) { inMsg.carbonCopy = Array.from(msg.carbonCopy); }
		if (msg.recipients) { inMsg.recipients = Array.from(msg.recipients); }
		return inMsg;
	}

	async addMsg(recipients: string[], msg: OutgoingMessage, id: string,
			sendImmeditely = false): Promise<void> {
		await this.delayRequest();
		if (this.msgs.has(id)) { throw new Error(
			`Message with id ${id} has already been added for delivery`); }
		if (!Array.isArray(recipients) || (recipients.length === 0)) {
			throw new Error(`Given invalid recipients: ${recipients} for message ${id}`); }
		let info: DeliveryProgress = {
			allDone: false,
			msgSize: await getMsgSize(msg),
			recipients: {}
		};
		for (let address of recipients) {
			info.recipients[address] = {
				done: false,
				bytesSent: 0
			};
		}
		this.msgs.set(id, { msg, info });
		if (sendImmeditely ||
				((info.msgSize * recipients.length) <= SMALL_MSG_SIZE)) {
			this.doCompleteDelivery(id);
		} else {
			this.deliveryQueue.push(id);
			this.doQueuedDelivery();
		}
	}

	private getQueuedItem(): { id?: string; info?: DeliveryProgress;
			msg?: OutgoingMessage; recipient?: string; } {
		let id = this.deliveryQueue[0];
		let dInfo = this.msgs.get(id);
		if (!dInfo) {
			this.deliveryQueue.shift();
			return {};
		}
		let { info, msg } = dInfo;
		if (info.allDone) {
			this.deliveryQueue.shift();
			return {};
		}
		let recipient: string = (undefined as any);
		for (let address of Object.keys(info.recipients)) {
			let recInfo = info.recipients[address];
			if (!recInfo.done) {
				recipient = address;
				break;
			}
		}
		if (!recipient) {
			info.allDone = true;
			this.deliveryQueue.shift();
			this.notifyOfProgress(id, info, true);
			return {};
		}
		return { id, info, msg, recipient };
	}

	private async doQueuedDelivery(): Promise<void> {
		if (this.sendingNow.size > 0) { return; }
		if (this.deliveryQueue.length === 0) { return; }
		let { id, info, msg, recipient } = this.getQueuedItem();
		if (!id || !info || !msg || !recipient) {
			this.doQueuedDelivery();
			return;
		}
		let recInfo = info.recipients[recipient];
		this.sendingNow.add(id);
		if (recInfo.bytesSent === 0) {
			try {
				await sleep(this.latencyMillis);
				let allowedSize = this.firstStageOfMsgSending(recipient);
				this.notifyOfProgress(id, info);
				if (info.msgSize > allowedSize) {
					throw msgTooBigExc(recipient, allowedSize);
				}
			} catch (err) {
				this.sendingNow.delete(id);
				recInfo.done = true;
				recInfo.err = err;
				this.notifyOfProgress(id, info);
				this.doQueuedDelivery();
				return;
			}
		}
		let sendChunk = Math.min(
			MAX_SENDING_CHUNK, info.msgSize - recInfo.bytesSent);
		let millisOut = Math.floor(sendChunk / this.upSpeedKBs);
		setTimeout(async (id: string, info: DeliveryProgress,
				recipient: string, msg: OutgoingMessage, sendChunk: number) => {
			let recInfo = info.recipients[recipient];
			try {
				if ((recInfo.bytesSent + sendChunk) >= info.msgSize) {
					recInfo.idOnDelivery = await this.saveMsgToRecipientData(
						recipient, msg);
					recInfo.bytesSent = info.msgSize;
					recInfo.done = true;
				} else {
					recInfo.bytesSent += sendChunk;
				}
			} catch (err) {
				recInfo.err = err;
				recInfo.done = true;
			} finally {
				this.sendingNow.delete(id);
				this.notifyOfProgress(id, info);
				this.doQueuedDelivery();
			}
		}, millisOut, id, info, recipient, msg, sendChunk);
	}

	private notifyOfProgress(id: string, info: DeliveryProgress,
			complete = false, err?: any): void {
		let cbIds = this.progressCBs.get(id);
		if (cbIds) {
			for (let cbId of cbIds) {
				let cb = this.callbacks.get(cbId);
				if (cb) { cb(info); }
			}
		}
		if (complete) {
			let deferreds = this.deferreds.get(id);
			if (deferreds) {
				for (let deferred of deferreds) {
					if (err) { deferred.reject(err); }
					else { deferred.resolve(info); }
				}
			}
			this.deferreds.delete(id);
			this.progressCBs.delete(id);
		}
	}

	private async deliverWholeMsgTo(recipient: string, id: string,
			info: DeliveryProgress, msg: OutgoingMessage): Promise<void> {
		let recInfo = info.recipients[recipient];
		if (!recInfo) { throw new Error(
			`Message info doesn't contain section for recipient ${recipient}`); }
		try {
			await sleep(this.latencyMillis);
			let allowedSize = this.firstStageOfMsgSending(recipient);
			this.notifyOfProgress(id, info);
			if (info.msgSize > allowedSize) {
				throw msgTooBigExc(recipient, allowedSize);
			}
			let millisToSend = Math.floor(info.msgSize / this.upSpeedKBs);
			let chunkFor500Millis = Math.floor(info.msgSize * 500 / millisToSend);
			while (millisToSend > 500) {
				await sleep(100);
				recInfo.bytesSent += chunkFor500Millis;
				this.notifyOfProgress(id, info);
				millisToSend -= 500;
			}
			await sleep(millisToSend);
			recInfo.idOnDelivery = await this.saveMsgToRecipientData(
				recipient, msg);
			recInfo.bytesSent = info.msgSize;
		} catch (err) {
			recInfo.err = err;
		} finally {
			recInfo.done = true;
			this.notifyOfProgress(id, info);
		}
	}

	private async doCompleteDelivery(id: string): Promise<void> {
		this.sendingNow.add(id);
		let dInfo = this.msgs.get(id);
		if (!dInfo) { return; }
		let { info, msg } = dInfo;
		try {
			for (let recipient of Object.keys(info.recipients)) {
				await this.deliverWholeMsgTo(recipient, id, info, msg);
			}
			info.allDone = true;
			this.notifyOfProgress(id, info, true);
		} catch (err) {
			this.notifyOfProgress(id, info, true, err);			
		} finally {
			this.sendingNow.delete(id);
		}
		this.doQueuedDelivery();
	}

	async listMsgs(): Promise<{ id: string; info: DeliveryProgress; }[]> {
		await this.delayRequest();
		let lst: { id: string; info: DeliveryProgress; }[] = [];
		for (let entry of this.msgs.entries()) {
			lst.push({
				id: entry[0],
				info: entry[1].info
			});
		}
		return lst;
	}

	async completionOf(id: string): Promise<DeliveryProgress|undefined> {
		await this.delayRequest();
		let m = this.msgs.get(id);
		if (!m) { return; }
		let deferred = defer<DeliveryProgress>();
		if (m.info.allDone) { return m.info; }
		let deferreds = this.deferreds.get(id);
		if (!deferreds) {
			deferreds = [ deferred ];
			this.deferreds.set(id, deferreds);
		} else {
			deferreds.push(deferred);
		}
		return deferred.promise;
	}

	async registerProgressCB(id: string, cb: ProgressCB):
			Promise<number|undefined> {
		await this.delayRequest();
		let m = this.msgs.get(id);
		if (!m || m.info.allDone) { return; }
		let cbId: number;
		do {
			cbId = uint48();
		} while (this.callbacks.has(cbId));
		this.callbacks.set(cbId, cb);
		let cbs = this.progressCBs.get(id);
		if (cbs) {
			cbs.push(cbId);
		} else {
			this.progressCBs.set(id, [ cbId ]);
		}
		this.notifyOfProgress(id, m.info, m.info.allDone);
		return cbId;
	}

	async deregisterProgressCB(cbId: number): Promise<void> {
		await this.delayRequest();
		let cbs = this.callbacks.delete(cbId);
	}

	async currentState(id: string): Promise<DeliveryProgress|undefined> {
		await this.delayRequest();
		let m = this.msgs.get(id);
		if (!m) { return; }
		return m.info;
	}

	async rmMsg(id: string, cancelSending = false): Promise<void> {
		await this.delayRequest();
		let m = this.msgs.get(id);
		if (!m) { return; }
		if (!cancelSending && !m.info.allDone) { throw new Error(
			`Cannot remove message ${id}, cause sending is not complete.`); }
		if (!m.info.allDone) {
			let ind = this.deliveryQueue.indexOf(id);
			if (ind >= 0) {
				this.deliveryQueue.splice(ind, 1);
			}
			let deferreds = this.deferreds.get(id);
			if (deferreds) {
				for (let deferred of deferreds) {
					deferred.resolve(m.info);
				}
			}
		}
		this.msgs.delete(id);
		this.sendingNow.delete(id);
		this.deferreds.delete(id);
		this.progressCBs.delete(id);
	}

	wrap(): DeliveryService {
		let w: DeliveryService = {
			addMsg: bind(this, this.addMsg),
			currentState: bind(this, this.currentState),
			listMsgs: bind(this, this.listMsgs),
			preFlight: bind(this, this.preFlight),
			rmMsg: bind(this, this.rmMsg),
			deregisterProgressCB: bind(this, this.deregisterProgressCB),
			registerProgressCB: bind(this, this.registerProgressCB),
			completionOf: bind(this, this.completionOf)

		};
		Object.freeze(w);
		return w;
	}
	
}
Object.freeze(DeliveryMock.prototype);
Object.freeze(DeliveryMock);

export class InboxMock extends ServiceWithInitPhase implements InboxService {
	
	private userId: string = (undefined as any);
	private msgs: FS = (undefined as any);
	private latencyMillis = 10;
	
	constructor() {
		super();
		Object.seal(this);
	}
	
	async initFor(userId: string, config: ASMailMockConfig):
			Promise<void> {
		try {
			this.userId = userId;
			if (config.network.latencyMillis) {
				this.latencyMillis = config.network.latencyMillis;
			}
			let fs = await makeInboxFS(this.userId);
			this.msgs = await fs.writableSubRoot(MSGS_FOLDER);
			this.initializing.resolve();
			this.initializing = (undefined as any);
		} catch (e) {
			e = errWithCause(e, 'Mock of ASMail inbox failed to initialize');
			this.initializing.reject(e);
			throw e;
		}
	}
	
	async listMsgs(fromTS?: number): Promise<MsgInfo[]> {
		await this.delayRequest(Math.floor(this.latencyMillis/3));
		let msgFolders = await this.msgs.listFolder('');
		let list: MsgInfo[] = [];
		for (let msgFolder of msgFolders) {
			if (!msgFolder.isFolder) { throw new Error(`Have file ${msgFolder.name} in messages folder, where only folders are expected`); }
			let msg = await this.msgs.readJSONFile<IncomingMessage>(
				`${msgFolder.name}/${MAIN_MSG_OBJ}`);
			if (fromTS && (msg.deliveryTS < fromTS)) { continue; }
			list.push({
				msgId: msg.msgId,
				deliveryTS: msg.deliveryTS
			});
		}
		return list;
	}
	
	async removeMsg(msgId: string): Promise<void> {
		await this.delayRequest(Math.floor(this.latencyMillis/3));
		try {
			await this.msgs.deleteFolder(msgId, true);
		} catch(e) {
			if (!(<FileException> e).notFound) { throw e; }
			throw makeMsgNotFoundException(msgId);
		}
	}
	
	async getMsg(msgId: string): Promise<IncomingMessage> {
		await this.delayRequest(Math.floor(this.latencyMillis/3));
		let msg = await this.msgs.readJSONFile<IncomingMessage>(
			`${msgId}/${MAIN_MSG_OBJ}`).catch((exc: FileException) => {
				if (exc.notFound) { throw makeMsgNotFoundException(msgId); }
				else { throw exc; }
			});
		if (await this.msgs.checkFolderPresence(`${msgId}/${ATTACHMENTS_FOLDER}`)) {
			msg.attachments = toStorageFS(await this.msgs.readonlySubRoot(
				`${msgId}/${ATTACHMENTS_FOLDER}`, 'attachments'));
		}
		return msg;
	}
	
	wrap(): InboxService {
		let w: InboxService = {
			getMsg: bind(this, this.getMsg),
			listMsgs: bind(this, this.listMsgs),
			removeMsg: bind(this, this.removeMsg),
		};
		Object.freeze(w);
		return w;
	}
	
}
Object.freeze(InboxMock.prototype);
Object.freeze(InboxMock);

export class ASMailMock implements ASMailService {
	
	private userId: string = (undefined as any);
	delivery = new DeliveryMock();
	inbox = new InboxMock();
	private initializing = defer<void>();
	
	constructor() {
		Object.seal(this);
	}
	
	async initFor(userId: string, config: ASMailMockConfig):
			Promise<void> {
		try {
			this.userId = userId;
			await this.delivery.initFor(userId, config);
			await this.inbox.initFor(userId, config);
			this.initializing.resolve();
			this.initializing = (undefined as any);
		} catch (e) {
			this.initializing.reject(e);
			throw e;
		}
	}
	
	async getUserId(): Promise<string> {
		if (this.initializing) { await this.initializing.promise; }
		await sleep(0);
		return this.userId;
	}
		
	makeAttachmentsContainer(): AttachmentsContainer {
		return (new Container()).wrap();
	}
	
	wrap(): ASMailService {
		let w: ASMailService = {
			getUserId: bind(this, this.getUserId),
			delivery: this.delivery.wrap(),
			inbox: this.inbox.wrap(),
			makeAttachmentsContainer: bind(this, this.makeAttachmentsContainer)
		};
		Object.freeze(w);
		return w;
	}
	
}
Object.freeze(ASMailMock.prototype);
Object.freeze(ASMailMock);

Object.freeze(exports);