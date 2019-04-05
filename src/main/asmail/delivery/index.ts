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

import { getASMailServiceFor } from '../../../lib-client/service-locator';
import { bind } from '../../../lib-common/binding';
import { FileException, ensureCorrectFS }
	from '../../../lib-common/exceptions/file';
import { MailSender } from '../../../lib-client/asmail/sender';
import { Msg } from './msg';
import { OutgoingMessage, DeliveryProgress, Attachments,
	ResourcesForSending }
	from './common';
import { copy as jsonCopy } from '../../../lib-common/json-utils';
import { logError, logWarning } from '../../../lib-client/logging/log-to-file';
import { Observer as RxObserver } from 'rxjs';

type WritableFS = web3n.files.WritableFS;
type DeliveryService = web3n.asmail.DeliveryService;
type Observer<T> = web3n.Observer<T>;

const SMALL_MSG_SIZE = 1024*1024;

const MSGS_FOLDER = 'msgs';
function idToMsgFolder(id: string): string {
	if (id.indexOf('/') > -1) { throw new Error(
		`Message id ${id} contains illegal character '/'.`); }
	return `${MSGS_FOLDER}/${id}`;
}

export class Delivery {

	/**
	 * This is a container for all messages, added for delivery.
	 * Some of these can be done, some can still be in a sending process.
	 */
	private msgs = new Map<string, Msg>();

	/**
	 * These are deliveries that should go without waiting, like small messages.
	 */
	private immediateDelivery = new Set<Msg>();

	/**
	 * This is a queue for big messages.
	 */
	private queuedDelivery: Msg[] = [];

	private constructor(
		private fs: WritableFS,
		private r: ResourcesForSending
	) {
		ensureCorrectFS(fs, 'local', true);
		Object.freeze(this.r);
		Object.seal(this);
	}
	
	static async makeAndStart(fs: WritableFS, r: ResourcesForSending):
			Promise<Delivery> {
		const delivery = new Delivery(fs, r);
		await delivery.restartDeliveryOfMsgsAtStartup();
		return delivery;
	}

	wrap(): DeliveryService {
		const service: DeliveryService = {
			addMsg: bind(this, this.addMsg),
			currentState: bind(this, this.currentState),
			listMsgs: bind(this, this.listMsgs),
			preFlight: bind(this, this.preFlight),
			rmMsg: bind(this, this.rmMsg),
			observeDelivery: bind(this, this.observeDelivery)
		};
		return Object.freeze(service);
	}

	private async restartDeliveryOfMsgsAtStartup(): Promise<void> {
		const msgFolders = await this.fs.listFolder(MSGS_FOLDER)
		.catch(async (exc: FileException): Promise<undefined> => {
			if (!exc.notFound) { throw exc; }
			await this.fs.makeFolder(MSGS_FOLDER);
			return;
		});
		if (!msgFolders) { return; }
		for (const f of msgFolders) {
			const id = f.name;
			try {
				const msgFS = await this.fs.writableSubRoot(idToMsgFolder(id));
				const msg = await Msg.forRestart(id, msgFS, this.r);
				this.addMsgAndSchedule(msg, false);
			} catch (err) {
				await logError(err, `Cannot restart message ${id}.`);
			}
		}
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
		if (msg.isDone()) {
			if (observer.next) { observer.next(jsonCopy(msg.progress)); }
			if (observer.complete) { observer.complete(); }
			return () => {};
		}
		const subToProgress = msg.progress$.subscribe(
			observer as RxObserver<DeliveryProgress>);
		return () => { subToProgress.unsubscribe(); }
	}
	
	private async preFlight(recipient: string): Promise<number> {
		const sendParams = this.r.correspondents.paramsForSendingTo(recipient);
		let mSender: MailSender;
		if (sendParams) {
			mSender = await MailSender.fresh(
				(sendParams.auth ? this.r.address : undefined),
				recipient, getASMailServiceFor, sendParams.invitation);
		} else {
			mSender = await MailSender.fresh(
				undefined, recipient, getASMailServiceFor);
		}
		await mSender.performPreFlight();
		return mSender.maxMsgLength;
	}

	private async addMsg(recipients: string[], msgToSend: OutgoingMessage,
			id: string, sendImmediately?: boolean): Promise<void> {
		if (typeof id !== 'string') { throw new Error(
			'Given id for message is not a string'); }
		const sender = this.r.address;
		
		if (!Array.isArray(recipients) || (recipients.length === 0)) {
			throw new Error(`Given invalid recipients: ${recipients} for message ${id}`); }
		if (this.msgs.has(id)) { throw new Error(
			`Message with id ${id} has already been added for delivery`); }
		
		const attachments = Attachments.fromMsg(msgToSend);

		// save msg, in case delivery should be restarted
		const msgFS = await this.makeFSForNewMsg(id);
		const msg = await Msg.forNew(id, msgFS, msgToSend, sender, recipients,
			this.r, attachments);
		
		// add and schedule
		this.addMsgAndSchedule(msg, !!sendImmediately);
	}
	
	private async makeFSForNewMsg(id: string): Promise<WritableFS> {
		const msgFolderPath = idToMsgFolder(id);
		await this.fs.makeFolder(msgFolderPath, true)
		.catch((exc: FileException) => {
			if (!exc.alreadyExists) { throw exc; }
			throw new Error(`Message with id ${id} has already been added for delivery`);
		});
		return this.fs.writableSubRoot(msgFolderPath);
	}

	private addMsgAndSchedule(msg: Msg, sendImmediately: boolean): void {

		// pack message and add it
		this.msgs.set(msg.id, msg);

		// no scheduling for a complete message
		if (msg.isDone()) { return; }

		// start/schedule delivery process, according to message's size
		if (sendImmediately || (msg.deliverySizeLeft() <= SMALL_MSG_SIZE)) {
			this.immediateDelivery.add(msg);
			msg.sendThisSmallMsgInParallel().then(() => {
				if (msg.isDone()) {
					this.immediateDelivery.delete(msg);
					this.performQueuedDelivery();
				}
			}, async (err) => {
				await logWarning('Got error when sending a message', err);
				this.immediateDelivery.delete(msg);
				this.performQueuedDelivery();				
			});
		} else {
			this.queuedDelivery.push(msg);
			this.performQueuedDelivery();
		}
	}

	private performQueuedDelivery(): void {
		// do nothing, if there is no queue
		if (this.queuedDelivery.length === 0) { return; }
		// do nothing, if immediate delivery takes place
		if (this.immediateDelivery.size > 0) { return; }

		const msg = this.queuedDelivery[0];
		if (msg.isSendingNow()) { return; }
		
		msg.sendNextSequentialChunkOfThisBigMsg().then(() => {
			if (msg.isDone()) {
				if (msg === this.queuedDelivery[0]) {
					this.queuedDelivery.shift();
				}
			}
		}, async (err) => {
			await logWarning('Got error when sending a message', err);
			if (msg === this.queuedDelivery[0]) {
				this.queuedDelivery.shift();
			}
		}).then(() => { this.performQueuedDelivery(); });
	}

	private async listMsgs():
			Promise<{ id: string; info: DeliveryProgress; }[]> {
		const lst: { id: string; info: DeliveryProgress; }[] = [];
		for (const entry of this.msgs.entries()) {
			lst.push({
				id: entry[0],
				info: entry[1].progress
			});
		}
		return lst;
	}

	private async rmMsg(id: string, cancelSending?: boolean): Promise<void> {
		const msg = this.msgs.get(id);
		if (!msg) { return; }
		if (!msg.isDone()) {
			if (!cancelSending) { throw new Error(`Cannot remove message ${id}, cause sending is not complete.`); }
			await msg.cancelSending();
		}
		this.msgs.delete(id);
		this.immediateDelivery.delete(msg);
		const indInQueue = this.queuedDelivery.indexOf(msg);
		if (indInQueue > -1) {
			this.queuedDelivery.splice(indInQueue, 1);
		}
		await this.fs.deleteFolder(idToMsgFolder(id), true);
	}

	private async currentState(id: string): Promise<DeliveryProgress|undefined> {
		const msg = this.msgs.get(id);
		if (!msg) { return; }
		return msg.progress;
	}

}
Object.freeze(Delivery.prototype);
Object.freeze(Delivery);

Object.freeze(exports);