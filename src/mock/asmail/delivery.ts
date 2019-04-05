/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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

import { stringOfB64UrlSafeCharsSync, stringOfB64UrlSafeChars }
	from '../../lib-common/random-node';
import { sleep } from '../../lib-common/processes';
import { bind } from '../../lib-common/binding';
import { makeInboxFS } from '../mock-files';
import { errWithCause } from '../../lib-common/exceptions/error';
import { toCanonicalAddress } from '../../lib-common/canonical-address';
import { utf8 } from '../../lib-common/buffer-utils';
import { ATTACHMENTS_FOLDER, MAIN_MSG_OBJ, MSGS_FOLDER, ServiceWithInitPhase }
	from './common';
import { ASMailMockConfig, ASMailUserConfig } from '../conf';
import { iterFilesIn, iterFoldersIn, isContainerEmpty }
	from '../../main/asmail/msg/attachments-container';
import { Subject, Observer as RxObserver } from 'rxjs';
import { copy as jsonCopy } from '../../lib-common/json-utils';

type ServLocException = web3n.asmail.ServLocException;
type ASMailSendException = web3n.asmail.ASMailSendException;

function domainNotFoundExc(address: string): ServLocException {
	const exc: ServLocException = {
		runtimeException: true,
		type: 'service-locating',
		address,
		domainNotFound: true
	};
	return exc;
}

function noServiceRecordExc(address: string): ServLocException {
	const exc: ServLocException = {
		runtimeException: true,
		type: 'service-locating',
		address,
		noServiceRecord: true
	};
	return exc;
}

function unknownRecipientExc(recipient: string): ASMailSendException {
	return {
		runtimeException: true,
		type: 'asmail-delivery',
		address: recipient,
		unknownRecipient: true
	};
}

function msgTooBigExc(recipient: string, allowedSize: number):
		ASMailSendException {
	return {
		runtimeException: true,
		type: 'asmail-delivery',
		address: recipient,
		msgTooBig: true,
		allowedSize: allowedSize
	};
}

function inboxIsFullExc(recipient: string): ASMailSendException {
	return {
		runtimeException: true,
		type: 'asmail-delivery',
		address: recipient,
		inboxIsFull: true
	};
}

const DEFAULT_MSG_SIZE = 500*1024*1024;
const MSG_ID_LEN = 24;

type OutgoingMessage = web3n.asmail.OutgoingMessage;
type IncomingMessage = web3n.asmail.IncomingMessage;
type DeliveryProgress = web3n.asmail.DeliveryProgress;
type DeliveryService = web3n.asmail.DeliveryService;

function domainOfCanonicalAddr(cAddr: string): string {
	const d = cAddr.substring(cAddr.indexOf('@')+1);
	if (!d) { throw new Error(`Given address ${cAddr} is malformed`); }
	return d;
}

async function getMsgSize(msg: OutgoingMessage): Promise<number> {
	const main = JSON.stringify(msg, (k, v) => {
		if (k === 'attachments') { return undefined; }
		else { return v; }
	});
	let msgSize = utf8.pack(main).length;
	if (msg.attachments) {
		for (const f of iterFilesIn(msg.attachments)) {
			msgSize += await getFileSize(f.file);
		}
		for (const f of iterFoldersIn(msg.attachments)) {
			msgSize += await getFolderContentSize(f.folder);
		}
	}
	return msgSize;
}

type FS = web3n.files.FS;
type File = web3n.files.File;

async function getFolderContentSize(fs: FS): Promise<number> {
	let size = 0;
	const lst = await fs.listFolder('.');
	for (const f of lst) {
		if (f.isFile) {
			const file = await fs.readonlyFile(f.name);
			size += await getFileSize(file);
		} else if (f.isFolder) {
			const innerFS = await fs.readonlySubRoot(f.name);
			size += await getFolderContentSize(innerFS);
		}
	}
	return size;
}

async function getFileSize(file: File): Promise<number> {
	const fSize = (await file.stat()).size;
	if (fSize === undefined) { throw new Error(
		'Stats from file do not have size information'); }
	return (fSize + 80);
}

type Observer<T> = web3n.Observer<T>;

interface MsgAndInfo {
	msg: OutgoingMessage;
	info: DeliveryProgress;
}

const SMALL_MSG_SIZE = 1024*1024;
const MAX_SENDING_CHUNK = 512*1024;

class ListenerWrap<T> {
	constructor(
			public listener: T,
			public onend?: () => void) {
		Object.freeze(this);
	}
}
Object.freeze(ListenerWrap.prototype);
Object.freeze(ListenerWrap);

export class DeliveryMock extends ServiceWithInitPhase
		implements DeliveryService {
	
	private userId: string = (undefined as any);
	private existingUsers = new Map<string, ASMailUserConfig>();
	private knownDomains = new Set<string>();
	private misconfiguredDomains = new Set<string>();
	private latencyMillis = 100;
	private upSpeedKBs = 50;
	private msgs = new Map<string, MsgAndInfo>();
	private deliveryQueue: string[] = [];
	private sendingNow = new Set<string>();
	private progress$ = new Map<string, Subject<DeliveryProgress>>();
	
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
			if (config.network.upSpeedKBs) {
				this.upSpeedKBs = config.network.upSpeedKBs;
			}
			if (config.network.latencyMillis) {
				this.latencyMillis = config.network.latencyMillis;
			}
			if (Array.isArray(config.knownDomains)) {
				for (const d of config.knownDomains) {
					this.knownDomains.add(d);
				}
			}
			if (Array.isArray(config.misconfiguredDomains)) {
				for (const d of config.misconfiguredDomains) {
					this.misconfiguredDomains.add(d);
				}
			}
			if (Array.isArray(config.existingUsers)) {
				for (const settings of config.existingUsers) {
					settings.address = toCanonicalAddress(settings.address);
					this.existingUsers.set(settings.address, settings);
					this.knownDomains.add(domainOfCanonicalAddr(settings.address));
				}
			}
			this.initializing.resolve();
			this.initializing = (undefined as any);
		} catch (e) {
			e = errWithCause(e, 'Mock of ASMail delivery failed to initialize');
			this.initializing.reject(e);
			throw e;
		}
	}
	
	private firstStageOfMsgSending(toAddress: string): number {
		const cAddr = toCanonicalAddress(toAddress);
		const domain = domainOfCanonicalAddr(cAddr);
		if (!this.knownDomains.has(domain)) {
			throw domainNotFoundExc(toAddress);
		}
		if (this.misconfiguredDomains.has(domain)) {
			throw noServiceRecordExc(toAddress);
		}
		const recipient = this.existingUsers.get(cAddr);
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
		const inMsg = this.toIncomingMsg(msg);
		const recipientInbox = await makeInboxFS(recipient);
		const recipientMsgs = await recipientInbox.writableSubRoot(MSGS_FOLDER);
		async function makeMsgFS(): Promise<web3n.files.WritableFS> {
			try {
				await recipientMsgs.makeFolder(inMsg.msgId, true);
				return recipientMsgs.writableSubRoot(inMsg.msgId);
			} catch(e) {
				if (!(<web3n.files.FileException> e).alreadyExists) { throw e; }
				inMsg.msgId = await stringOfB64UrlSafeChars(MSG_ID_LEN);
				return makeMsgFS();
			}
		}
		const msgFS = await makeMsgFS();
		await msgFS.writeJSONFile(MAIN_MSG_OBJ, inMsg);
		if (!isContainerEmpty(msg.attachments)) {
			for (const f of iterFilesIn(msg.attachments)) {
				await msgFS.saveFile(f.file, `${ATTACHMENTS_FOLDER}/${f.fileName}`);
			}
			for (const f of iterFoldersIn(msg.attachments)) {
				await msgFS.saveFolder(f.folder, `${ATTACHMENTS_FOLDER}/${f.folderName}`);
			}
		}
		return inMsg.msgId;
	}
	
	private toIncomingMsg(msg: OutgoingMessage): IncomingMessage {
		const inMsg = <IncomingMessage> {
			msgId: stringOfB64UrlSafeCharsSync(MSG_ID_LEN),
			deliveryTS: Date.now(),
			sender: this.userId
		};
		if (msg.subject) { inMsg.subject = msg.subject; }
		if (msg.msgType) { inMsg.msgType = msg.msgType; }
		if (msg.plainTxtBody) { inMsg.plainTxtBody = msg.plainTxtBody; }
		if (msg.htmlTxtBody) { inMsg.htmlTxtBody = msg.htmlTxtBody; }
		if (msg.jsonBody !== undefined) { inMsg.jsonBody = msg.jsonBody; }
		if (msg.carbonCopy) { inMsg.carbonCopy = Array.from(msg.carbonCopy); }
		if (msg.recipients) { inMsg.recipients = Array.from(msg.recipients); }
		return inMsg;
	}

	async addMsg(recipients: string[], msg: OutgoingMessage, id: string,
			sendImmeditely = false): Promise<void> {
		if (typeof id !== 'string') { throw new Error(
			'Given id for message is not a string'); }
		await this.delayRequest();
		if (this.msgs.has(id)) { throw new Error(
			`Message with id ${id} has already been added for delivery`); }
		if (!Array.isArray(recipients) || (recipients.length === 0)) {
			throw new Error(`Given invalid recipients: ${recipients} for message ${id}`); }
		const info: DeliveryProgress = {
			allDone: false,
			msgSize: await getMsgSize(msg),
			recipients: {}
		};
		for (const address of recipients) {
			info.recipients[address] = {
				done: false,
				bytesSent: 0
			};
		}
		this.msgs.set(id, { msg, info });
		this.progress$.set(id, new Subject());
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
		const id = this.deliveryQueue[0];
		const dInfo = this.msgs.get(id);
		if (!dInfo) {
			this.deliveryQueue.shift();
			return {};
		}
		const { info, msg } = dInfo;
		if (info.allDone) {
			this.deliveryQueue.shift();
			return {};
		}
		let recipient: string = (undefined as any);
		for (const address of Object.keys(info.recipients)) {
			const recInfo = info.recipients[address];
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
		const { id, info, msg, recipient } = this.getQueuedItem();
		if (!id || !info || !msg || !recipient) {
			this.doQueuedDelivery();
			return;
		}
		const recInfo = info.recipients[recipient];
		this.sendingNow.add(id);
		if (recInfo.bytesSent === 0) {
			try {
				await sleep(this.latencyMillis);
				const allowedSize = this.firstStageOfMsgSending(recipient);
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
		const sendChunk = Math.min(
			MAX_SENDING_CHUNK, info.msgSize - recInfo.bytesSent);
		const millisOut = Math.floor(sendChunk / this.upSpeedKBs);
		setTimeout(async (id: string, info: DeliveryProgress,
				recipient: string, msg: OutgoingMessage, sendChunk: number) => {
			const recInfo = info.recipients[recipient];
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
		const progress$ = this.progress$.get(id);
		if (!progress$) { return; }
		progress$.next(jsonCopy(info));
		if (complete) {
			if (err) {
				progress$.error(err);
			} else {
				progress$.complete();
			}
			this.progress$.delete(id);
		}
	}

	private async deliverWholeMsgTo(recipient: string, id: string,
			info: DeliveryProgress, msg: OutgoingMessage): Promise<void> {
		const recInfo = info.recipients[recipient];
		if (!recInfo) { throw new Error(
			`Message info doesn't contain section for recipient ${recipient}`); }
		try {
			await sleep(this.latencyMillis);
			const allowedSize = this.firstStageOfMsgSending(recipient);
			this.notifyOfProgress(id, info);
			if (info.msgSize > allowedSize) {
				throw msgTooBigExc(recipient, allowedSize);
			}
			let millisToSend = Math.floor(info.msgSize / this.upSpeedKBs);
			const chunkFor500Millis = Math.floor(info.msgSize * 500 / millisToSend);
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
		const dInfo = this.msgs.get(id);
		if (!dInfo) { return; }
		const { info, msg } = dInfo;
		try {
			for (const recipient of Object.keys(info.recipients)) {
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
		const lst: { id: string; info: DeliveryProgress; }[] = [];
		for (const entry of this.msgs.entries()) {
			lst.push({
				id: entry[0],
				info: entry[1].info
			});
		}
		return lst;
	}

	observeDelivery(id: string, observer: Observer<DeliveryProgress>):
			() => void {
		const msg = this.msgs.get(id);
		if (!msg) {
			if (observer.error) {
				const exc = {
					runtimeException: true,
					type: 'msg-delivery-service',
					msgNotFound: true
				};
				observer.error(exc);
			}
			return () => {};
		}
		const progress$ = this.progress$.get(id);
		if (!progress$) {
			if (observer.complete) { observer.complete(); }
			return () => {};
		}
		const subToProgress = progress$.subscribe(
			observer as RxObserver<DeliveryProgress>);
		return () => subToProgress.unsubscribe();
	}

	async currentState(id: string): Promise<DeliveryProgress|undefined> {
		await this.delayRequest();
		const m = this.msgs.get(id);
		if (!m) { return; }
		return m.info;
	}

	async rmMsg(id: string, cancelSending = false): Promise<void> {
		await this.delayRequest();
		const m = this.msgs.get(id);
		if (!m) { return; }
		if (!m.info.allDone) {
			if (!cancelSending) { throw new Error(`Cannot remove message ${id}, cause sending is not complete.`); }
			const exc: web3n.asmail.ASMailSendException = {
				runtimeException: true,
				type: 'asmail-delivery',
				msgCancelled: true
			};
			this.notifyOfProgress(id, m.info, true, exc);
		}
		this.msgs.delete(id);
		if (!m.info.allDone) {
			const ind = this.deliveryQueue.indexOf(id);
			if (ind >= 0) {
				this.deliveryQueue.splice(ind, 1);
			}
			const progress$ = this.progress$.get(id);
			if (progress$) {
				const exc = {
					runtimeException: true,
					type: 'msg-delivery-service',
					msgCancelled: true
				};
				progress$.error(exc);
				this.progress$.delete(id);
			}
			this.sendingNow.delete(id);
		}
	}

	wrap(): DeliveryService {
		const w: DeliveryService = {
			addMsg: bind(this, this.addMsg),
			currentState: bind(this, this.currentState),
			listMsgs: bind(this, this.listMsgs),
			preFlight: bind(this, this.preFlight),
			rmMsg: bind(this, this.rmMsg),
			observeDelivery: bind(this, this.observeDelivery)
		};
		Object.freeze(w);
		return w;
	}
	
}
Object.freeze(DeliveryMock.prototype);
Object.freeze(DeliveryMock);

Object.freeze(exports);