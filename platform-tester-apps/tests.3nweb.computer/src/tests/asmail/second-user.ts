/*
 Copyright (C) 2021 - 2022 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { logErr } from "../../test-page-utils.js";

type IncomingMessage = web3n.asmail.IncomingMessage;
type OutgoingMessage = web3n.asmail.OutgoingMessage;

export interface TestSignal<T> {
	testSignal: T;
}

async function sendTestSignal<T>(userNum: number, msg: T): Promise<void> {
	await w3n.testStand.sendMsgToOtherLocalTestUser(userNum, undefined, msg);
}

export interface EchoMsgSignal extends TestSignal<'message-echo'> {
	msg: IncomingMessage;
}

export interface FileTreeListing {
	[name: string]: FileTreeListing|number;
}

async function echoIncomingMessageToFstUser(
	msg: IncomingMessage
): Promise<void> {
	if (msg.attachments) {
		try {
			(msg as any).attachments = await listFileTree(msg.attachments);
		} catch (err) {
			await w3n.testStand.log('error', `Error in listing incoming message attachments`, err);
		}
	}
	await sendTestSignal<EchoMsgSignal>(1, {
		testSignal: 'message-echo',
		msg
	});
}

async function listFileTree(
	fs: web3n.files.ReadonlyFS
): Promise<FileTreeListing> {
	const tree: FileTreeListing = {};
	for (const entry of (await fs.listFolder('.'))) {
		if (entry.isFile) {
			const fileContent = await fs.readBytes(entry.name);
			tree[entry.name] = (fileContent ? fileContent.length : 0);
		} else if (entry.isFolder) {
			const subFS = await fs.readonlySubRoot(entry.name);
			tree[entry.name] = await listFileTree(subFS);
		}
	}
	return tree;
}

export interface AskToSendMsgBackSignal
extends TestSignal<'ask-to-send-msg-back'> {
	msg: OutgoingMessage
}

export async function setupSecondUserASMailTestReactions(): Promise<void> {

	const alreadyEchoedMsgs = new Set<string>();
	const userOne = await w3n.testStand.idOfTestUser(1);

	// echo back all mail messages
	w3n.mail!.inbox.subscribe('message', {
		next: async msg => {
			if (msg.msgType === 'mail') {
				if (alreadyEchoedMsgs.has(msg.msgId)) {
					await w3n.testStand.log('error', `Inbox generated 'message' event with an already echoed msg ${msg.msgId}, why?`);
				} else {
					alreadyEchoedMsgs.add(msg.msgId);
					await echoIncomingMessageToFstUser(msg);
				}
			}
		},
		error: err => logErr(`Error occurred in listening for messages`, err)
	});

	// attend signal asking to send message back
	w3n.testStand.observeMsgsFromOtherLocalTestUser(1, undefined, {
		next: async (sig: AskToSendMsgBackSignal) => {
			if (sig.testSignal !== 'ask-to-send-msg-back') { return; }
			try {
				await sendMsg(userOne, sig.msg);
			} catch (err) {
				await w3n.testStand.log('error', `Error in sending message to ${userOne}`, err);
			}
		}
	});

}

async function sendMsg(userId: string, msg: OutgoingMessage): Promise<void> {
	const deliveryId = `${Date.now()}`;
	await w3n.mail!.delivery.addMsg([ userId ], msg, deliveryId);
	await new Promise((resolve, reject) =>  w3n.mail!.delivery.observeDelivery(
		deliveryId, {
			next: async progress => {
				if (progress.allDone) {
					const err = progress.recipients[userId].err;
					if (err) {
						reject(err);
					} else {
						try {
							await w3n.mail!.delivery.rmMsg(deliveryId);
						} catch (err) {
							reject(err);
						} finally {
							resolve(undefined);
						}
					}
				}
			},
			error: reject
		}));
}

export function listenForOneMsgEchoFromSecondUser(): Promise<EchoMsgSignal> {
	return new Promise((resolve, reject) => {
		const unsub = w3n.testStand.observeMsgsFromOtherLocalTestUser(
			2, undefined, {
				next: async (sig: EchoMsgSignal) => {
					unsub();
					resolve(sig);
				},
				error: reject
			});
	});
}

export async function askSecondUserToSendMsg(
	msg: OutgoingMessage
): Promise<void> {
	await sendTestSignal<AskToSendMsgBackSignal>(2, {
		testSignal: 'ask-to-send-msg-back',
		msg
	});
}
