/*
 Copyright (C) 2016 - 2018, 2020 - 2021 3NSoft Inc.
 
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

import { bytesSync } from '../../../lib-common/random-node.js';
import { SpecDescribe } from '../../libs-for-tests/spec-module.js';
import { askSecondUserToSendMsg, FileTreeListing, listenForOneMsgEchoFromSecondUser } from '../second-user.js';
import { SpecIt, throwDeliveryErrorFrom, FileTreeContent, writeFilesTreeContent, compareTreeListingWithExpectedContent } from '../test-utils.js';
import { logErr } from '../../../test-page-utils.js';

const folderContent: FileTreeContent = {
	'file1': 'This is file content for file #1',
	'child folder 1': {
		'file1': 'This is file content for file #1',
	},
	'child folder 2': {
		'file2': bytesSync(123456),
	},
};

type DeliveryProgress = web3n.asmail.DeliveryProgress;
type OutgoingMessage = web3n.asmail.OutgoingMessage;
type IncomingMessage = web3n.asmail.IncomingMessage;

export const specs: SpecDescribe = {
	description: '.sendMsg',
	its: []
};

let it: SpecIt = {
	expectation: 'sending and getting message with attachments from synced fs'
};
it.func = async function(s) {
	await writeFilesTreeContent(folderContent, s.testFolder);
	const msgEchoPromise = listenForOneMsgEchoFromSecondUser();

	const txtBody = 'Some text\nBlah-blah-blah';

	const recipient = s.secondUser;

	// put message together
	const outMsg: OutgoingMessage = {
		msgType: 'mail',
		plainTxtBody: txtBody
	};
	outMsg.attachments = { files: {}, folders: {} };
	for (const entry of (await s.testFolder.listFolder('.'))) {
		if (entry.isFile) {
			outMsg.attachments.files![entry.name] =
				await s.testFolder.readonlyFile(entry.name);
		} else if (entry.isFolder) {
			outMsg.attachments.folders![entry.name] =
				await s.testFolder.readonlySubRoot(entry.name);
		}
	}

	// send message
	const idForSending = `${Date.now()}`;
	await w3n.mail!.delivery.addMsg([ recipient ], outMsg, idForSending);
	expect(await w3n.mail!.delivery.currentState(idForSending)).toBeTruthy();
	const notifs: DeliveryProgress[] = [];
	await new Promise((resolve, reject) => {
		const observer: web3n.Observer<DeliveryProgress> = {
			next: (p: DeliveryProgress) => { notifs.push(p); },
			complete: resolve as () => void, error: reject
		};
		const cbDetach = w3n.mail!.delivery.observeDelivery(
			idForSending, observer);
		expect(typeof cbDetach).toBe('function');
	});
	expect(notifs.length).toBeGreaterThan(0);
	const lastInfo = notifs[notifs.length-1];
	expect(typeof lastInfo).toBe('object');
	expect(lastInfo.allDone).toBe(true);
	throwDeliveryErrorFrom(lastInfo);
	await w3n.mail!.delivery.rmMsg(idForSending);
	expect(await w3n.mail!.delivery.currentState(idForSending)).toBeFalsy();
	const recInfo = lastInfo!.recipients[recipient];
	expect(typeof recInfo.bytesSent).toBe('number');
	expect(typeof recInfo.idOnDelivery).toBe('string');
	const msgId = recInfo.idOnDelivery!;

	expect(msgId).toBeTruthy();

	// get from signal what recipient side got
	const inMsg = (await msgEchoPromise).msg;
	expect(inMsg).toBeTruthy();
	expect(inMsg.plainTxtBody).toBe(txtBody);
	expect(inMsg.msgId).toBe(msgId);
	expect(inMsg.msgType).toBe('mail');
	expect(compareTreeListingWithExpectedContent(
		inMsg.attachments as any, folderContent)).toBe(true);

};
specs.its.push(it);

async function doRoundTripSendingToEstablishInvites(): Promise<void> {
	const msgFromSub = new Promise<IncomingMessage>((resolve, reject) => {
		const unsub = w3n.mail!.inbox.subscribe('message', {
			next: msg => {
				unsub();
				resolve(msg);
			},
			error: reject
		});
	});
	await askSecondUserToSendMsg({
		msgType: 'mail',
		plainTxtBody: `Message for roundtrip around ${Date.now()}`
	});
	const inMsg = await msgFromSub;
	await w3n.mail!.inbox.listMsgs();
	await w3n.mail!.inbox.removeMsg(inMsg.msgId).catch(logErr);
}

it = {
	expectation: 'sending and getting message with MBs attachment',
	// XXX round trip doesn't work, yet
	disableIn: 'big-msg-allowance'
};
it.func = async function(s) {

	await doRoundTripSendingToEstablishInvites();

	const recipient = s.secondUser;
	const msgEchoPromise = listenForOneMsgEchoFromSecondUser();

	const fileName = 'big file';
	const fileLen = 3000000;
	await s.testFolder.writeBytes(fileName, bytesSync(fileLen));
	const txtBody = 'Some text\nBlah-blah-blah';

	// put together
	const outMsg: OutgoingMessage = {
		msgType: 'mail',
		plainTxtBody: txtBody
	};
	outMsg.attachments = { files: {} };
	outMsg.attachments.files![fileName] =
		await s.testFolder.readonlyFile(fileName);

	// send message
	const idForSending = `${Date.now()}`;
	await w3n.mail!.delivery.addMsg([ recipient ], outMsg, idForSending);
	expect(await w3n.mail!.delivery.currentState(idForSending)).toBeTruthy();
	const notifs: DeliveryProgress[] = [];
	await new Promise((resolve, reject) => {
		const observer: web3n.Observer<DeliveryProgress> = {
			next: (p: DeliveryProgress) => { notifs.push(p); },
			complete: resolve as () => void, error: reject
		};
		const cbDetach = w3n.mail!.delivery.observeDelivery(
			idForSending, observer);
		expect(typeof cbDetach).toBe('function');
	});
	expect(notifs.length).toBeGreaterThan(0);
	const lastInfo = notifs[notifs.length-1];
	expect(typeof lastInfo).toBe('object');
	expect(lastInfo.allDone).toBe(true);
	throwDeliveryErrorFrom(lastInfo);
	await w3n.mail!.delivery.rmMsg(idForSending);
	expect(await w3n.mail!.delivery.currentState(idForSending)).toBeFalsy();
	const recInfo = lastInfo!.recipients[recipient];
	expect(recInfo.bytesSent).toBeGreaterThan(fileLen);
	expect(typeof recInfo.idOnDelivery).toBe('string');
	const msgId = recInfo.idOnDelivery!;

	expect(msgId).toBeTruthy();

	// get from signal what recipient side got
	const inMsg = (await msgEchoPromise).msg;
	expect(inMsg).toBeTruthy();
	expect(inMsg.msgId).toBe(msgId);
	expect(inMsg.plainTxtBody).toBe(txtBody);
	const attachmentsLst: FileTreeListing = inMsg.attachments as any;
	expect(attachmentsLst).withContext(`Signal from recipient should have seen attachments in sent message`).toBeDefined();
	expect(attachmentsLst[fileName]).toBe(fileLen);

};
it.timeout = 45*1000;
specs.its.push(it);
