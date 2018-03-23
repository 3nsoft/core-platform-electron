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

import { MsgPacker, headers, PackJSON }
	from '../../../lib-client/asmail/msg/packer';
import { defer, Deferred, SingleProc } from '../../../lib-common/processes';
import { utf8 } from '../../../lib-common/buffer-utils';
import { OutgoingMessage, DeliveryProgress, ResourcesForSending, Attachments,
	SavedMsgToSend, SEG_SIZE_IN_K_QUATS, estimatePackedSizeOf }
	from './common';
import { WIP, WIPstate } from './per-recipient-wip';
import { Observable, Subject } from 'rxjs';
import { copy as jsonCopy } from '../../../lib-common/json-utils';

type WritableFS = web3n.files.WritableFS;
type File = web3n.files.File;

const MAIN_OBJ_FILE_NAME = 'msg.json';
const PROGRESS_INFO_FILE_NAME = 'progress.json';
const WIPS_INFO_FILE_NAME = 'wips.json';

type ProgressNotifier = (id: string, info: DeliveryProgress) => void;

function checkIfAllRecipientsDone(progress: DeliveryProgress): boolean {
	for (const recipient of Object.keys(progress.recipients)) {
		const recInfo = progress.recipients[recipient];
		if (!recInfo.done) { return false; }
	}
	return true;
}

async function estimatedPackedSize(msgToSend: OutgoingMessage,
		attachments?: Attachments): Promise<number> {
	let totalSize = estimatePackedSizeOf(
		utf8.pack(JSON.stringify(msgToSend)).length);
	if (attachments) {
		totalSize += await attachments.estimatedPackedSize();
	}
	return totalSize;
}

export class Msg {

	private sendingProc = new SingleProc();
	private completionPromise: Deferred<DeliveryProgress>|undefined = undefined;
	private progressSavingProc = new SingleProc();
	private cancelled = false;
	private sender: string = (undefined as any);
	private recipients: string[] = (undefined as any);
	private msgToSend: OutgoingMessage = (undefined as any);
	private attachments: Attachments|undefined = undefined;
	private sequentialWIP: WIP|undefined = undefined;
	public wipsInfo: { [recipient: string]: WIPstate } = {};
	
	private progressPublisher = new Subject<DeliveryProgress>();
	public get progress$(): Observable<DeliveryProgress> {
		return this.progressPublisher.asObservable();
	}

	private constructor (
			public id: string,
			public r: ResourcesForSending,
			public progress: DeliveryProgress,
			private msgFS: WritableFS) {
		Object.seal(this);
	}
	
	static async forNew(id: string, msgFS: WritableFS,
			msgToSend: OutgoingMessage, sender: string, recipients: string[],
			r: ResourcesForSending, attachments?: Attachments): Promise<Msg> {
		const progress: DeliveryProgress = {
			allDone: false,
			msgSize: await estimatedPackedSize(msgToSend, attachments),
			recipients: {}
		};
		for (const recipient of recipients) {
			progress.recipients[recipient] = {
				done: false,
				bytesSent: 0
			};
		}
		const msg = new Msg(id, r, progress, msgFS);
		msg.msgToSend = msgToSend;
		msg.sender = sender;
		msg.recipients = recipients;
		msg.attachments = attachments;
		await msg.save();
		return msg;
	}

	static async forRestart(id: string, msgFS: WritableFS,
			r: ResourcesForSending): Promise<Msg> {
		const progress = await msgFS.readJSONFile<DeliveryProgress>(
			PROGRESS_INFO_FILE_NAME);
		if (progress.allDone) {
			return new Msg(id, (undefined as any), progress, (undefined as any));
		}
		const msg = new Msg(id, r, progress, msgFS);
		const main = await msgFS.readJSONFile<SavedMsgToSend>(
			MAIN_OBJ_FILE_NAME);
		msg.msgToSend = main.msgToSend;
		msg.sender = main.sender;
		msg.recipients = main.recipients;
		msg.attachments = await Attachments.readFrom(msgFS);
		if (await msgFS.checkFilePresence(WIPS_INFO_FILE_NAME)) {
			msg.wipsInfo = (await msgFS.readJSONFile<any>(
				WIPS_INFO_FILE_NAME)).json;
		}
		return msg;
	}

	private async save(): Promise<void> {
		const main: SavedMsgToSend = {
			msgToSend: this.msgToSend,
			sender: this.sender,
			recipients: this.recipients
		};
		await this.msgFS.writeJSONFile(MAIN_OBJ_FILE_NAME, main, true, true);
		await this.msgFS.writeJSONFile(PROGRESS_INFO_FILE_NAME, this.progress, true, true);
		if (this.attachments) {
			await this.attachments.linkIn(this.msgFS);
		}
	}

	notifyOfChanges(saveProgress: boolean, saveWIPs: boolean): void {
		if (this.cancelled) { return; }
		if (this.progress.allDone) { return; }
		if (checkIfAllRecipientsDone(this.progress)) {
			this.progress.allDone = true;
			saveProgress = true;
		}
		this.progressPublisher.next(jsonCopy(this.progress));
		if (saveProgress) {
			this.progressSavingProc.startOrChain(async () => {
				await this.msgFS.writeJSONFile(
					PROGRESS_INFO_FILE_NAME, this.progress, false);
			});
		}
		if (this.isDone()) {
			this.progressPublisher.complete();
			this.progressSavingProc.startOrChain(async () => {
				await this.msgFS.deleteFile(WIPS_INFO_FILE_NAME).catch(() => {});
				if (this.attachments) {
					await this.attachments.deleteFrom(this.msgFS);
				}
			});
		} else if (saveWIPs) {
			this.progressSavingProc.startOrChain(async () => {
				await this.msgFS.writeJSONFile(
					WIPS_INFO_FILE_NAME, this.wipsInfo);
			});
		}
	}

	async msgPacker(pack?: PackJSON): Promise<MsgPacker> {
		if (pack) {
			return MsgPacker.fromPack(pack, SEG_SIZE_IN_K_QUATS, this.attachments);
		}
		const msg = MsgPacker.empty(SEG_SIZE_IN_K_QUATS);
		msg.setHeader(headers.FROM, this.sender);
		if (typeof this.msgToSend.plainTxtBody === 'string') {
			msg.setPlainTextBody(this.msgToSend.plainTxtBody);
		} else if (typeof this.msgToSend.htmlTxtBody === 'string') {
			msg.setHtmlTextBody(this.msgToSend.htmlTxtBody);
		}
		if (this.msgToSend.jsonBody !== undefined) {
			msg.setJsonBody(this.msgToSend.jsonBody);
		}
		msg.setHeader(headers.MSG_TYPE, this.msgToSend.msgType);
		msg.setHeader(headers.SUBJECT, this.msgToSend.subject);
		msg.setHeader(headers.CC, this.msgToSend.carbonCopy);
		msg.setHeader(headers.TO, this.msgToSend.recipients);
		if (this.attachments) {
			await msg.setAttachments(this.attachments);
		}
		return msg;
	}

	isDone(): boolean {
		return this.progress.allDone;
	}

	isSendingNow(): boolean {
		return !!this.sendingProc.getP();
	}

	deliverySizeLeft(): number {
		if (this.progress.allDone) { return 0; }
		let sizeLeft = 0;
		for (const recipient of Object.keys(this.progress.recipients)) {
			const recInfo = this.progress.recipients[recipient];
			if (recInfo.done) { continue; }
			sizeLeft += Math.max(0, this.progress.msgSize - recInfo.bytesSent);
		}
		return sizeLeft;
	}

	getCompletionPromise(): Promise<DeliveryProgress> {
		if (this.isDone()) { throw new Error(`Message delivery has already completed.`); }
		if (!this.completionPromise) {
			this.completionPromise = defer<DeliveryProgress>();
		}
		return this.completionPromise.promise;
	}

	/**
	 * Calling this method sets this message as cancelled. When returned promise
	 * completes, it is safe to remove message's folder.
	 */
	async cancelSending(): Promise<void> {
		if (this.cancelled) { return; }
		this.cancelled = true;
		const filesProc = this.progressSavingProc.getP();
		if (!filesProc) { return; }
		await filesProc.catch(() => {});
		const exc: web3n.asmail.ASMailSendException = {
			runtimeException: true,
			type: 'asmail-delivery',
			msgCancelled: true
		};
		this.progressPublisher.error(exc);
	}

	/**
	 * This starts sending a message to all recipients in parallel, and should be
	 * used on small messages. For small messages, recipient-specific processes'
	 * intermediate states are not saved, unlike big messages.
	 * Returned promise completes when sending completes. Check isDone() method
	 * to see if sending should be started again, when network connectivity comes
	 * back.
	 */
	sendThisSmallMsgInParallel(): Promise<void> {
		if (this.isDone()) { throw new Error(`Message ${this.id} has already been sent.`) }
		return this.sendingProc.start(async (): Promise<void> => {

			// setup work-in-progress objects
			const wips: WIP[] = [];
			for (const recipient of Object.keys(this.progress.recipients)) {
				const recInfo = this.progress.recipients[recipient];
				if (recInfo.done) { continue; }
				const state = this.wipsInfo[recipient];
				if (state) {
					wips.push(await WIP.resume(this, state, this.r.cryptor));
				} else {
					wips.push(WIP.fresh(this, recipient, this.r.cryptor));
				}
			}

			// start all process in parallel, and await
			const wipPromises = wips.map(async (wip): Promise<void> => {
				while (!wip.isDone()) {
					if (this.cancelled) {
						await wip.cancel();
					}
					await wip.startNext();
				}
			});
			await Promise.all(wipPromises);
		}).then(() => {
			if (this.completionPromise && this.isDone()) {
				this.completionPromise.resolve(this.progress);
				this.completionPromise = undefined;
			}
		}, (err) => {
			if (this.completionPromise) {
				this.completionPromise.reject(err);
				this.completionPromise = undefined;
			}
		});
	}

	/**
	 * This starts sending a message, sequentially, one recipient at a time, and
	 * should be used on big (not small) messages. For big messages,
	 * recipient-specific processes' intermediate states are saved, unlike small
	 * messages.
	 * Returned promise completes when sending completes. Check isDone() method
	 * to see if sending should be started again, when network connectivity comes
	 * back.
	 */
	sendNextSequentialChunkOfThisBigMsg(): Promise<void> {
		if (this.isDone()) { throw new Error(`Message ${this.id} has already been sent.`) }
		return this.sendingProc.start(async (): Promise<void> => {

			// setup sequential wip, if it is not present, and if there is work
			if (!this.sequentialWIP) {
				// look for a recipient, to who delivery is not done
				let recipient: string|undefined = undefined;
				for (const address of Object.keys(this.progress.recipients)) {
					const recInfo = this.progress.recipients[address];
					if (!recInfo.done) {
						recipient = address;
						break;
					}
				}
				if (!recipient) { return; }
				const state = this.wipsInfo[recipient];
				this.sequentialWIP = (state ?
					(await WIP.resume(this, state, this.r.cryptor)) :
					WIP.fresh(this, recipient, this.r.cryptor));
			}

			// do next chunk of work, removing wip, if it is done
			await this.sequentialWIP.startNext();
			if (this.sequentialWIP.isDone()) {
				this.sequentialWIP = undefined;
			}

		}).then(() => {
			if (this.completionPromise && this.isDone()) {
				this.completionPromise.resolve(this.progress);
				this.completionPromise = undefined;
			}
		}, (err) => {
			if (this.completionPromise) {
				this.completionPromise.reject(err);
				this.completionPromise = undefined;
			}
		});
	}

}
Object.freeze(Msg.prototype);
Object.freeze(Msg);

Object.freeze(exports);