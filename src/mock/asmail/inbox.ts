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

import { makeInboxFS } from '../mock-files';
import { errWithCause } from '../../lib-common/exceptions/error';
import { FileException } from '../../lib-common/exceptions/file';
import { bind } from '../../lib-common/binding';
import { ATTACHMENTS_FOLDER, MAIN_MSG_OBJ, MSGS_FOLDER, ServiceWithInitPhase }
	from './common';
import { ASMailMockConfig } from '../conf';
import { Observable, Observer as RxObserver } from 'rxjs';

type InboxException = web3n.asmail.InboxException;
type Observer<T> = web3n.Observer<T>;
type FolderEvent = web3n.files.FolderEvent;
type EntryAdditionEvent = web3n.files.EntryAdditionEvent;
type WritableFS = web3n.files.WritableFS;

function makeMsgNotFoundException(msgId: string): InboxException {
	return {
		runtimeException: true,
		type: 'inbox',
		msgId,
		msgNotFound: true
	};
}

type IncomingMessage = web3n.asmail.IncomingMessage;
type MsgInfo = web3n.asmail.MsgInfo;
type InboxService = web3n.asmail.InboxService;

export class InboxMock extends ServiceWithInitPhase implements InboxService {
	
	private userId: string = (undefined as any);
	private msgs: WritableFS = (undefined as any);
	private latencyMillis = 10;
	
	constructor() {
		super();
		Object.seal(this);
	}
	
	async initFor(userId: string, config: ASMailMockConfig): Promise<void> {
		try {
			this.userId = userId;
			if (config.network.latencyMillis) {
				this.latencyMillis = config.network.latencyMillis;
			}
			const fs = await makeInboxFS(this.userId);
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
		const msgFolders = await this.msgs.listFolder('');
		const list: MsgInfo[] = [];
		for (const msgFolder of msgFolders) {
			if (!msgFolder.isFolder) { throw new Error(`Have file ${msgFolder.name} in messages folder, where only folders are expected`); }
			const msg = await this.msgs.readJSONFile<IncomingMessage>(
				`${msgFolder.name}/${MAIN_MSG_OBJ}`);
			if (fromTS && (msg.deliveryTS < fromTS)) { continue; }
			list.push({
				msgType: msg.msgType,
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
		return this.pickMsgFromDisk(msgId);
	}

	private async pickMsgFromDisk(msgId: string): Promise<IncomingMessage> {
		const msg = await this.msgs.readJSONFile<IncomingMessage>(
			`${msgId}/${MAIN_MSG_OBJ}`).catch((exc: FileException) => {
				if (exc.notFound) { throw makeMsgNotFoundException(msgId); }
				else { throw exc; }
			});
		if (await this.msgs.checkFolderPresence(`${msgId}/${ATTACHMENTS_FOLDER}`)) {
			msg.attachments = await this.msgs.readonlySubRoot(
				`${msgId}/${ATTACHMENTS_FOLDER}`);
		}
		return msg;
	}

	subscribe(event: string, observer: Observer<IncomingMessage>): () => void {
		if (!observer.next && !observer.complete && !observer.error) {
			throw new Error(`Given observer has no methods for events/notifications`); }
		if (event === 'message') {
			return this.observeIncomingMessages(observer);
		} else {
			throw new Error(`Event ${event} is unknown for inbox service`);
		}
	}

	private observeIncomingMessages(observer: Observer<IncomingMessage>):
			() => void {
		const subscription = (new Observable<FolderEvent>(
			folderObserver => this.msgs.watchFolder('', folderObserver))
		.filter(folderEvent => {
			if (folderEvent.type !== 'entry-addition') { return false; }
			const entry = (folderEvent as EntryAdditionEvent).entry;
			return !!entry.isFolder;
		}) as Observable<EntryAdditionEvent>)
		.delay(200)
		.flatMap(newEntryEvent => {
			const msgId = newEntryEvent.entry.name;
			return this.pickMsgFromDisk(msgId);
		})
		.subscribe(observer as RxObserver<IncomingMessage>);
		return () => subscription.unsubscribe();
	}

	wrap(): InboxService {
		const w: InboxService = {
			getMsg: bind(this, this.getMsg),
			listMsgs: bind(this, this.listMsgs),
			removeMsg: bind(this, this.removeMsg),
			subscribe: bind(this, this.subscribe)
		};
		Object.freeze(w);
		return w;
	}
	
}
Object.freeze(InboxMock.prototype);
Object.freeze(InboxMock);

Object.freeze(exports);