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

import { Duplex, EventEnvelope } from '../lib-common/ipc/electron-ipc';
import { asmail } from './common';
import { Container } from '../lib-client/asmail/attachments/container';
import { Proxies, FSDetails } from './storage';

type FS = web3n.storage.FS;
type File = web3n.storage.File;
type InboxService = web3n.asmail.InboxService;
type MsgInfo = web3n.asmail.MsgInfo;
type IncomingMessage = web3n.asmail.IncomingMessage;
type OutgoingMessage = web3n.asmail.OutgoingMessage;
type DeliveryProgress = web3n.asmail.DeliveryProgress;

let names = asmail.uiReqNames;
let evChan = asmail.eventChannels;

export function makeASMailOnUISide(core: Duplex, proxies: Proxies):
		web3n.asmail.Service {
	
	let inbox: InboxService = {
		
		listMsgs(fromTS?: number): Promise<MsgInfo[]> {
			return core.makeRequest<MsgInfo[]>(
				names.inbox.listMsgs, fromTS);
		},
		
		removeMsg(msgId: string): Promise<void> {
			return core.makeRequest<void>(names.inbox.removeMsg, msgId);
		},
		
		async getMsg(msgId: string): Promise<IncomingMessage> {
			let msg = await core.makeRequest<IncomingMessage>(
				names.inbox.getMsg, msgId);
			if (msg.attachments) {
				let fsInfo = ((msg.attachments as any) as FSDetails);
				msg.attachments = proxies.getFS(fsInfo);
			}
			return msg;
		}

	};
	Object.freeze(inbox);

	let delivery: web3n.asmail.DeliveryService = {
		
		preFlight(toAddress: string): Promise<number> {
			return core.makeRequest<number>(
				names.delivery.sendPreFlight, toAddress);
		},

		addMsg(recipients: string[], msg: OutgoingMessage, id: string,
				sendImmediately = false): Promise<void> {
			if (typeof sendImmediately !== 'boolean') { throw new Error(); }
			// prepare attachments pointers
			let attachments: asmail.AttachmentsContainer|undefined;
			let attachmentsFS: string|undefined;
			if (msg.attachments) {
				attachments = {
					files: {},
					folders: {}
				};
				for (let entry of msg.attachments.getAllFiles().entries()) {
					let fileId = proxies.fileToIdMap.get(entry[1]);
					if (fileId) {
						attachments.files[entry[0]] = fileId;
					}
				}
				for (let entry of msg.attachments.getAllFolders().entries()) {
					let fsId = proxies.fsToIdMap.get(entry[1]);
					if (fsId) {
						attachments.folders[entry[0]] = fsId;
					}
				}
			} else if (msg.attachmentsFS) {
				attachmentsFS = proxies.fsToIdMap.get(msg.attachmentsFS);
			}

			// prepare shallow message copy without attachments' fields.
			let msgCopy: any = {};
			for (let field of Object.keys(msg)) {
				if ((field === 'attachments') || (field === 'attachmentsFS')) {
					continue;
				}
				msgCopy[field] = msg[field];
			}

			let req: asmail.RequestAddMsgToSend = {
				recipients, id, sendImmediately,
				msg: msgCopy, attachments, attachmentsFS };

			return core.makeRequest<void>(names.delivery.addMsg, req);
		},
		
		listMsgs(): Promise<{ id: string; info: DeliveryProgress; }[]> {
			return core.makeRequest<{ id: string; info: DeliveryProgress; }[]>(
				names.delivery.listMsgs, null);
		},

		completionOf(id: string): Promise<DeliveryProgress|undefined> {
			return core.makeRequest<DeliveryProgress|undefined>(
				names.delivery.completionOf, id);
		},

		async registerProgressCB(id: string, cb: (p: DeliveryProgress) => void):
				Promise<number|undefined> {
			let cbId = core.addInboundEventListener(evChan.deliveryProgress,
				(event: EventEnvelope<asmail.DeliveryProgressEvent>) => {
					if (event.eventPayload.id !== id) { return; }
					let p = event.eventPayload.p;
					cb(event.eventPayload.p);
					if (p.allDone) {
						core.removeInboundEventListener(cbId);
					}
				});
			let msgStatus = await delivery.currentState(id);
			if (msgStatus && !msgStatus.allDone) {
				return cbId;
			} else {
				core.removeInboundEventListener(cbId);
				return;
			}
		},

		async deregisterProgressCB(cbId: number): Promise<void> {
			core.removeInboundEventListener(cbId);
		},

		currentState(id: string): Promise<DeliveryProgress> {
			return core.makeRequest<DeliveryProgress|undefined>(
				names.delivery.currentState, id);
		},

		rmMsg(id: string, cancelSending = false): Promise<void> {
			if (typeof cancelSending !== 'boolean') { throw new Error(); }
			let req: asmail.RequestRmMsgFromSending = { id, cancelSending };
			return core.makeRequest<void>(names.delivery.rmMsg, req);
		}
		
	};
	Object.freeze(delivery);

	let mail: web3n.asmail.Service = {
		
		inbox,
		delivery,

		getUserId(): Promise<string> {
			return core.makeRequest<string>(names.getUserId, null);
		},
		
		makeAttachmentsContainer(): web3n.asmail.AttachmentsContainer {
			return new Container();
		}
		
	};
	Object.freeze(mail);
	return mail;
}

Object.freeze(exports);