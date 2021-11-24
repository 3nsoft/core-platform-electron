/*
 Copyright (C) 2021 3NSoft Inc.
 
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
import { listenForTestSignals, sendMsg, sendTestSignal, TestSignal } from "../../test-apps-signalling.js";

type IncomingMessage = web3n.asmail.IncomingMessage;
type OutgoingMessage = web3n.asmail.OutgoingMessage;

export interface EchoMsgSignal extends TestSignal {
	testSignal: 'message-echo';
	msg: IncomingMessage;
}

export interface FileTreeListing {
	[name: string]: FileTreeListing|number;
}

async function echoIncomingMessage(
	userId: string, msg: IncomingMessage
): Promise<void> {
	if (msg.attachments) {
		try {
			(msg as any).attachments = await listFileTree(msg.attachments);
		} catch (err) {
			await logErr(`Error in listing incoming message attachments`, err);
		}
	}
	await sendTestSignal<EchoMsgSignal>(userId, {
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

export interface AskToSendMsgBackSignal {
	testSignal: 'ask-to-send-msg-back',
	msg: OutgoingMessage
}

export function setupSecondUserASMailTestReactions() {

	const alreadyEchoedMsgs = new Set<string>();

	// echo back all mail messages
	w3n.mail!.inbox.subscribe('message', {
		next: async msg => {
			if (msg.msgType === 'mail') {
				if (alreadyEchoedMsgs.has(msg.msgId)) {
					await logErr(`Inbox generated 'message' event with an already echoed msg ${msg.msgId}, why?`);
				} else {
					alreadyEchoedMsgs.add(msg.msgId);
					await echoIncomingMessage(msg.sender, msg);
				}
			}
		},
		error: err => logErr(`Error occurred in listening for messages`, err)
	});

	// attend signal asking to send message back
	listenForTestSignals('ask-to-send-msg-back', async (
		sig: AskToSendMsgBackSignal, sender: string
	) => {
		try {
			await sendMsg(sender, sig.msg);
		} catch (err) {
			await logErr(`Error in sending message to ${sender}`, err);
		}
	});

}

export function listenForOneMsgEcho(): Promise<EchoMsgSignal> {
	return new Promise((resolve, reject) => {
		const unsub = listenForTestSignals('message-echo', (
			sig: EchoMsgSignal
		) => {
			unsub();
			resolve(sig);
		});
	});
}

export async function askUserToSendMsg(
	userId: string, msg: OutgoingMessage
): Promise<void> {
	await sendTestSignal<AskToSendMsgBackSignal>(userId, {
		testSignal: 'ask-to-send-msg-back',
		msg
	});
}
