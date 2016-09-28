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

import { stringOfB64UrlSafeChars } from '../../lib-client/random-node';
import { sleep } from '../../lib-common/processes';
import { bind } from '../../lib-common/binding';
import { makeInboxFS } from './mock-files';
import { FS } from '../../lib-client/local-files/device-fs';
import { makeRuntimeException } from '../../lib-common/exceptions/runtime';
import { errWithCause } from '../../lib-common/exceptions/error';
import { FileException } from '../../lib-common/exceptions/file';
import { toCanonicalAddress } from '../../lib-common/canonical-address';
import { utf8 } from '../../lib-common/buffer-utils';
import { defer } from '../../lib-common/processes';
import { pipe } from '../../lib-common/byte-streaming/pipe';
import { toStorageFS } from './storage';

export interface ASMailUserConfig {
	address: string;
	defaultMsgSize?: number;
	inboxIsFull?: boolean;
}

export interface ASMailMockConfig {
	existingUsers?: ASMailUserConfig[];
	knownDomains?: string[];
	misconfiguredDomains?: string[];
	msgSendDelayMillis?: number;
}

const EXCEPTION_TYPE = 'service-locating';

function makeDomainException(flag: string, address: string):
		Web3N.ASMail.ServLocException {
	let exc = <Web3N.ASMail.ServLocException> makeRuntimeException(
		flag, EXCEPTION_TYPE);
	if (address) {
		exc.address = address;
	}
	return exc;
}

function domainNotFoundExc(address?: string): Web3N.ASMail.ServLocException {
	return makeDomainException('domainNotFound', address);
}

function noServiceRecordExc(address?: string): Web3N.ASMail.ServLocException {
	return makeDomainException('noServiceRecord', address);
}

function makeDeliveryException(flag: string, recipient: string):
		Web3N.ASMail.ASMailSendException {
	let exc = <Web3N.ASMail.ASMailSendException> makeRuntimeException(
		flag, 'asmail-delivery');
	exc.address = recipient;
	return exc;
}

function badRedirectExc(recipient: string): Web3N.ASMail.ASMailSendException {
	return makeDeliveryException('badRedirect', recipient);
}

function unknownRecipientExc(recipient: string):
		Web3N.ASMail.ASMailSendException {
	return makeDeliveryException('unknownRecipient', recipient);
}

function msgTooBigExc(recipient: string, allowedSize: number):
		Web3N.ASMail.ASMailSendException {
	let exc = makeDeliveryException('msgTooBig', recipient);
	exc.allowedSize = allowedSize;
	return exc;
}

function senderNotAllowedExc(recipient: string):
		Web3N.ASMail.ASMailSendException {
	return makeDeliveryException('senderNotAllowed', recipient);
}

function inboxIsFullExc(recipient: string): Web3N.ASMail.ASMailSendException {
	return makeDeliveryException('inboxIsFull', recipient);
}

function authFailedOnDeliveryExc(recipient: string):
		Web3N.ASMail.ASMailSendException {
	return makeDeliveryException('authFailedOnDelivery', recipient);
}

function makeInboxException(flag: string, msgId: string):
		Web3N.ASMail.InboxException {
	let exc = <Web3N.ASMail.InboxException> makeRuntimeException(
		flag, 'inbox');
	exc.msgId = msgId;
	return exc;
}

function makeMsgNotFoundException(msgId: string): Web3N.ASMail.InboxException {
	return makeInboxException('msgNotFound', msgId);
}

function makeObjNotFoundException(msgId: string, objId: string):
		Web3N.ASMail.InboxException {
	let exc = makeInboxException('objNotFound', msgId);
	exc.objId = objId;
	return exc;
}

function makeMsgIsBrokenException(msgId: string): Web3N.ASMail.InboxException {
	return makeInboxException('msgIsBroken', msgId);
}

const MSGS_FOLDER = 'msgs';
const MAIN_MSG_OBJ = 'main.json';
const ATTACHMENTS_FOLDER = 'attachments';
const FILE_PIPE_BUFFER_SIZE = 1024*1024;

const DEFAULT_MSG_SIZE = 100*1024*1024;
const MSG_ID_LEN = 24;

function domainOfCanonicalAddr(cAddr: string): string {
	let d = cAddr.substring(cAddr.indexOf('@')+1);
	if (!d) { throw new Error(`Given address ${cAddr} is malformed`); }
	return d;
}

async function getMsgSize(msg: Web3N.ASMail.OutgoingMessage): Promise<number> {
	let main = JSON.stringify(msg, (k, v) => {
		if (k === 'attachments') { return undefined; }
		else { return v; }
	});
	let msgSize = utf8.pack(main).length;
	if (msg.attachments) {
		let attachments = msg.attachments.getAll();
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
		let list = await msg.attachmentsFS.listFolder('');
		for (let f of list) {
			if (f.isFile) {
				let stats = await msg.attachmentsFS.statFile(f.name);
				msgSize += stats.size;
			} else if (f.isFolder) {
				// XXX implement finding out complete size of all objects in folder
				throw new Error(
					'Calculation of directory size is not implemented, yet.');
			}
		}
	}
	return msgSize;
}

export class ASMailMock implements Web3N.ASMail.Service {
	
	private userId: string = null;
	private fs: FS = null;
	private msgs: FS = null;
	private existingUsers = new Map<string, ASMailUserConfig>();
	private knownDomains = new Set<string>();
	private misconfiguredDomains = new Set<string>();
	private msgSendDelayMillis = 10;
	private initializing = defer<void>();
	
	constructor() {
		Object.seal(this);
	}
	
	async initFor(userId: string, config: ASMailMockConfig):
			Promise<void> {
		try {
			this.userId = userId;
			if (config.msgSendDelayMillis) {
				this.msgSendDelayMillis = config.msgSendDelayMillis;
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
			this.fs = await makeInboxFS(this.userId);
			this.msgs = await this.fs.makeSubRoot(MSGS_FOLDER);
			this.initializing.resolve();
			this.initializing = null;
		} catch (e) {
			e = errWithCause(e, 'Mock of ASMail service failed to initialize');
			this.initializing.reject(e);
			throw e;
		}
	}
	
	async getUserId(): Promise<string> {
		if (this.initializing) { await this.initializing.promise; }
		await sleep(0);
		return this.userId;
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
		if (this.initializing) { await this.initializing.promise; }
		await sleep(Math.floor(this.msgSendDelayMillis/2));
		return this.firstStageOfMsgSending(toAddress);
	}
	
	async sendMsg(recipient: string, msg: Web3N.ASMail.OutgoingMessage):
			Promise<string> {
		if (this.initializing) { await this.initializing.promise; }
		await sleep(Math.floor(this.msgSendDelayMillis/2));
		let allowedSize = this.firstStageOfMsgSending(recipient);
		let msgSize = await getMsgSize(msg);
		if (msgSize > allowedSize) {
			throw msgTooBigExc(recipient, allowedSize);
		}
		await sleep(Math.floor(this.msgSendDelayMillis/2));
		let msgId = await this.saveMsgToRecipientData(recipient, msg);
		return msgId;
	}
	
	private async saveMsgToRecipientData(recipient: string,
			msg: Web3N.ASMail.OutgoingMessage): Promise <string> {
		let inMsg = this.toIncomingMsg(msg);
		let recipientInbox = await makeInboxFS(recipient);
		let recipientMsgs = await recipientInbox.makeSubRoot(MSGS_FOLDER);
		async function makeMsgFS(): Promise<Web3N.Files.FS> {
			try {
				await recipientMsgs.makeFolder(inMsg.msgId, true);
				return recipientMsgs.makeSubRoot(inMsg.msgId);
			} catch(e) {
				if (!(<Web3N.Files.FileException> e).alreadyExists) { throw e; }
				inMsg.msgId = stringOfB64UrlSafeChars(MSG_ID_LEN);
				return makeMsgFS();
			}
		}
		let msgFS = await makeMsgFS();
		await msgFS.writeJSONFile(MAIN_MSG_OBJ, inMsg);
		if (msg.attachments) {
			let attachments = msg.attachments.getAll();
			if (attachments.size > 0) {
				for (let nameAndFile of attachments.entries()) {
					let name = nameAndFile[0];
					let f = nameAndFile[1];
					let src = await f.getByteSource();
					let sink = await msgFS.getByteSink(
						`${ATTACHMENTS_FOLDER}/${name}`, true, true);
					await pipe(src, sink, true, FILE_PIPE_BUFFER_SIZE);
				}
			}
		} else if (msg.attachmentsFS) {
			let list = await msg.attachmentsFS.listFolder('');
			if (list.length > 0) {
				for (let f of list) {
					if (f.isFile) {
						let src = await msg.attachmentsFS.getByteSource(f.name);
						let sink = await msgFS.getByteSink(
							`${ATTACHMENTS_FOLDER}/${f.name}`, true, true);
						await pipe(src, sink, true, FILE_PIPE_BUFFER_SIZE);
					} else if (f.isFolder) {
						// XXX implement folder copy
						throw new Error(
							'Copy of directory is not implemented, yet.');
					}
				}
			}
		}
		return inMsg.msgId;
	}
	
	private toIncomingMsg(msg: Web3N.ASMail.OutgoingMessage):
			Web3N.ASMail.IncomingMessage {
		let inMsg = <Web3N.ASMail.IncomingMessage> {
			msgId: stringOfB64UrlSafeChars(MSG_ID_LEN),
			deliveryTS: Date.now(),
			sender: this.userId
		};
		if (msg.subject) { inMsg.subject = msg.subject; }
		if (msg.msgType) { inMsg.msgType = msg.msgType; }
		if (msg.chatId) { inMsg.chatId = msg.chatId; }
		if (msg.plainTxtBody) { inMsg.plainTxtBody = msg.plainTxtBody; }
		if (msg.htmlTxtBody) { inMsg.htmlTxtBody = msg.htmlTxtBody; }
		if (msg.carbonCopy) { inMsg.carbonCopy = [].concat(msg.carbonCopy); }
		if (msg.recipients) { inMsg.recipients = [].concat(msg.recipients); }
		return inMsg;
	}
	
	async listMsgs(fromTS?: number): Promise<Web3N.ASMail.MsgInfo[]> {
		if (this.initializing) { await this.initializing.promise; }
		await sleep(Math.floor(this.msgSendDelayMillis/3));
		let msgFolders = await this.msgs.listFolder('');
		let list: Web3N.ASMail.MsgInfo[] = [];
		for (let msgFolder of msgFolders) {
			if (!msgFolder.isFolder) { throw new Error(`Have file ${msgFolder.name} in messages folder, where only folders are expected`); }
			let msg = await this.msgs.readJSONFile<Web3N.ASMail.IncomingMessage>(
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
		if (this.initializing) { await this.initializing.promise; }
		await sleep(Math.floor(this.msgSendDelayMillis/3));
		try {
			await this.msgs.deleteFolder(msgId, true);
		} catch(e) {
			if (!(<FileException> e).notFound) { throw e; }
			throw makeMsgNotFoundException(msgId);
		}
	}
	
	async getMsg(msgId: string): Promise<Web3N.ASMail.IncomingMessage> {
		if (this.initializing) { await this.initializing.promise; }
		await sleep(Math.floor(this.msgSendDelayMillis/3));
		let msg = await this.msgs.readJSONFile<Web3N.ASMail.IncomingMessage>(
			`${msgId}/${MAIN_MSG_OBJ}`).catch((exc: FileException) => {
				if (exc.notFound) { throw makeMsgNotFoundException(msgId); }
				else { throw exc; }
			});
		if (await this.msgs.checkFolderPresence(`${msgId}/${ATTACHMENTS_FOLDER}`)) {
			msg.attachments = toStorageFS(await this.msgs.makeSubRoot(
				`${msgId}/${ATTACHMENTS_FOLDER}`));
		}
		return msg;
	}
		
	makeAttachmentsContainer(): Web3N.ASMail.AttachmentsContainer {
		return (new Attachments()).wrap();
	}
	
	wrap(): Web3N.ASMail.Service {
		let w: Web3N.ASMail.Service = {
			getMsg: bind(this, this.getMsg),
			getUserId: bind(this, this.getUserId),
			listMsgs: bind(this, this.listMsgs),
			preFlight: bind(this, this.preFlight),
			removeMsg: bind(this, this.removeMsg),
			sendMsg: bind(this, this.sendMsg),
			makeAttachmentsContainer: bind(this, this.makeAttachmentsContainer)
		};
		Object.freeze(w);
		return w;
	}
	
}
Object.freeze(ASMailMock.prototype);
Object.freeze(ASMailMock);

// XXX can this be used in an actual implementation?
class Attachments implements Web3N.ASMail.AttachmentsContainer {

	private files = new Map<string, Web3N.Files.File>();

	addFile(file: Web3N.Files.File, newName?: string): void {
		let name = (newName ? newName : file.name);
		if (this.files.has(name)) { throw new Error(
			`File name ${name} is already used by another attachment`); }
		this.files.set(name, file);
	}

	rename(initName: string, newName: string): void {
		let f = this.files.get(initName);
		if (f) { throw new Error(`Unkown entity with name ${initName}`); }
		if (initName === newName) { return; }
		if (this.files.has(newName)) { throw new Error(
			`Name ${newName} is already used by another attachment`); }
		this.files.set(newName, f);
		this.files.delete(initName);
	}

	getAll(): Map<string, Web3N.Files.File> {
		return this.files;
	}

	wrap(): Web3N.ASMail.AttachmentsContainer {
		let w: Web3N.ASMail.AttachmentsContainer = {
			addFile: bind(this, this.addFile),
			rename: bind(this, this.rename),
			getAll: bind(this, this.getAll)
		};
		Object.freeze(w);
		return w;
	}

}
Object.freeze(Attachments.prototype);
Object.freeze(Attachments);

Object.freeze(exports);