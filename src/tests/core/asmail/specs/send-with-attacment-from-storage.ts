/*
 Copyright (C) 2016 - 2018 3NSoft Inc.
 
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

import { SpecDescribe, SpecIt } from '../../../libs-for-tests/spec-module';
import { exec, execExpects } from '../../../libs-for-tests/setups';
import { AppRunner } from '../../../libs-for-tests/app-runner';
import { stringOfB64CharsSync } from '../../../../lib-common/random-node';
import { W3N, sendTxtMsg, sendTxtMsgNumOfChecks } from '../test-utils';

declare var w3n: W3N;

type WritableFS = web3n.files.WritableFS;
type ReadonlyFS = web3n.files.ReadonlyFS;
type File = web3n.files.File;

interface FileParams {
	name: string;
	content: string;
}

interface FolderParams {
	name: string;
	files: FileParams[];
	folders: FolderParams[];
}

const files: FileParams[] = [{
	content: 'This is file content for file #1',
	name: 'file1'
}, {
	content: 'Content for file #2 (longer file)\n'+stringOfB64CharsSync(100000),
	name: 'file2'
}];
const folder: FolderParams = {
	name: 'parent folder',
	files: [ files[0] ],
	folders: [ {
		name: 'child folder 1',
		files: [ files[0] ],
		folders: []
	}, {
		name: 'child folder 2',
		files: [ files[1] ],
		folders: []
	} ]
};

type DeliveryProgress = web3n.asmail.DeliveryProgress;
type OutgoingMessage = web3n.asmail.OutgoingMessage;

export const specs: SpecDescribe = {
	description: '.sendMsg',
	its: []
};

let it: SpecIt = {
	expectation: 'sending and getting message with attachments from synced fs',
	funcArgs: [ 'app1', 'app2' ]
};
it.func = async function(app1: () => AppRunner, app2: () => AppRunner) {
	const txtBody = 'Some text\nBlah-blah-blah';

	// user 1 sends message to user 2
	app1().c.timeouts('script', 7000);
	const msgId = await execExpects(app1().c, async function(
		recipient: string, txtBody: string, files: FileParams[],
		folder: FolderParams
	) {
		// make fs objects for attachment
		const appFS = await w3n.storage.getAppSyncedFS('computer.3nweb.test');
		const filesToAttach: File[] = [];
		for (const fp of files) {
			const path = fp.name;
			await appFS.writeTxtFile(path, fp.content);
			const file = await appFS.readonlyFile(path);
			filesToAttach.push(file);
		}
		const makeFolderIn = async (parent: WritableFS,
				folder: FolderParams): Promise<WritableFS> => {
			const fs = await parent.writableSubRoot(folder.name);
			for (const fp of folder.files) {
				await fs.writeTxtFile(fp.name, fp.content);
			}
			for (const fp of folder.folders) {
				await makeFolderIn(fs, fp);
			}
			return fs;
		};
		const folderToAttach = await makeFolderIn(appFS, folder);

		// put together and send message
		const msg: OutgoingMessage = {
			msgType: 'mail',
			plainTxtBody: txtBody
		};
		msg.attachments = { files: {}, folders: {} };
		for (const file of filesToAttach) {
			msg.attachments.files![file.name] = file;
		}
		msg.attachments.folders![folderToAttach.name] = folderToAttach;
		const idForSending = 'a1b2';
		await w3n.mail.delivery.addMsg([ recipient ], msg, idForSending);
		expect(await w3n.mail.delivery.currentState(idForSending)).toBeTruthy();
		const notifs: DeliveryProgress[] = [];
		await new Promise((resolve, reject) => {
			const observer: web3n.Observer<DeliveryProgress> = {
				next: (p: DeliveryProgress) => { notifs.push(p); },
				complete: resolve, error: reject
			};
			const cbDetach = w3n.mail.delivery.observeDelivery(
				idForSending, observer);
			expect(typeof cbDetach).toBe('function');
		});
		expect(notifs.length).toBeGreaterThan(0);
		const lastInfo = notifs[notifs.length-1];
		expect(typeof lastInfo).toBe('object');
		expect(lastInfo.allDone).toBe(true);
		await w3n.mail.delivery.rmMsg(idForSending);
		expect(await w3n.mail.delivery.currentState(idForSending)).toBeFalsy();
		const recInfo = lastInfo!.recipients[recipient];
		expect(typeof recInfo.idOnDelivery).toBe('string');
		expect(recInfo.err).toBeFalsy(`error when sending message to a particular recipient`);
		return recInfo.idOnDelivery!;
	}, [ app2().user.userId, txtBody, files, folder ], 8);

	if (!msgId) { throw new Error(
		`got bad message id after sending: ${msgId}`); }
	
	// user 2 gets incoming message
	app2().c.timeouts('script', 7000);
	await execExpects(app2().c, async function(
		msgId: string, txtBody: string, files: FileParams[], folder: FolderParams
	) {
		// check message
		const msgs = await w3n.mail.inbox.listMsgs();
		const msgInfo = msgs.find(m => (m.msgId === msgId));
		expect(msgInfo).toBeTruthy(`message ${msgId} should be present in a list of all messages`);
		const msg = await w3n.mail.inbox.getMsg(msgId);
		expect(msg).toBeTruthy();
		expect(msg.plainTxtBody).toBe(txtBody);

		// check attachments presence
		expect(!!msg.attachments).toBe(true, `attachments should be present in message ${msgId}`);
		const attachments = msg.attachments;
		if (!attachments) { throw new Error(`skipping further checks`); }

		// check files in attachments
		for (const fp of files) {
			expect(await attachments.readTxtFile(fp.name)).toBe(fp.content, `file content should be exactly what has been sent`);
		}

		// check folder in attachments
		const checkFolderIn = async (parent: ReadonlyFS,
				params: FolderParams) => {
			expect(await parent.checkFolderPresence(params.name)).toBe(true, `folder ${params.name} should be present in ${parent.name}`);
			const fs = await parent.readonlySubRoot(params.name);
			for (const fp of params.files) {
				expect(await fs.readTxtFile(fp.name)).toBe(fp.content, `file content should be exactly what has been sent`);
			}
			for (const fp of params.folders) {
				await checkFolderIn(fs, fp);
			}				
		};
		await checkFolderIn(attachments, folder);

	}, [ msgId, txtBody, files, folder ], 4 + 2 + 6);

};
specs.its.push(it);

async function doRoundTripSendingToEstablishInvites(
	app1: AppRunner, app2: AppRunner
): Promise<void> {
	// send message from 1 to 2
	await execExpects(app1.c,
		sendTxtMsg, [ app2.user.userId, 'some text' ], sendTxtMsgNumOfChecks);

	// read message from 1, and send reply, which establishes channel with invite
	await exec(app2.c, async function(recipient: string) {
		await w3n.mail.inbox.listMsgs();
		const msg: OutgoingMessage = {
			msgType: 'mail',
			plainTxtBody: 'some text'
		};
		const idForSending = 'h3j4k5';
		await w3n.mail.delivery.addMsg([ recipient ], msg, idForSending);
		await new Promise((resolve, reject) => {
			w3n.mail.delivery.observeDelivery(
				idForSending, { complete: resolve, error: reject });
		});
		await w3n.mail.delivery.rmMsg(idForSending);
	}, app1.user.userId);

	// read message from 2, to pick up established channel with invite
	await exec(app1.c, async function() {
		await w3n.mail.inbox.listMsgs();
	});
}

it = {
	expectation: 'sending and getting message with MBs attachment',
	funcArgs: [ 'app1', 'app2' ]
};
it.func = async function(app1: () => AppRunner, app2: () => AppRunner) {
	// send small messages to establish trusted channel, else we hit a limit
	// for a message from an unknown sender
	await doRoundTripSendingToEstablishInvites(app1(), app2());
	
	// this text body will be used as a known end of long attachment, which
	// recipient will check.
	const txtBody = stringOfB64CharsSync(1000);
	const fileName = 'big file';

	// user 1 sends message to user 2
	app1().c.timeouts('script', 7000);
	const msgId = await execExpects(app1().c, async function(
		recipient: string, txtBody: string, fileName: string
	) {
		// make big file for attachment
		const appFS = await w3n.storage.getAppSyncedFS('computer.3nweb.test');
		const sink = await appFS.getByteSink(fileName);
		const buffer = new Uint8Array(10000);
		for (let i=1; i<=300; i+=1) {
			crypto.getRandomValues(buffer);
			await sink.write(buffer);
		}
		// fingerprint bytes at the end
		const endBytes = new Uint8Array(txtBody.split('').map(
			char => char.charCodeAt(0)));
		await sink.write(endBytes);
		await sink.write(null);
		
		// put together and send message
		const msg: OutgoingMessage = {
			msgType: 'mail',
			plainTxtBody: txtBody
		};
		msg.attachments = { files: {} };
		msg.attachments.files![fileName] = await appFS.readonlyFile(fileName);
		const idForSending = 'q2w3e4';
		await w3n.mail.delivery.addMsg([ recipient ], msg, idForSending);
		expect(await w3n.mail.delivery.currentState(idForSending)).toBeTruthy();
		const notifs: DeliveryProgress[] = [];
		await new Promise((resolve, reject) => {
			const observer: web3n.Observer<DeliveryProgress> = {
				next: (p: DeliveryProgress) => { notifs.push(p); },
				complete: resolve, error: reject
			};
			const cbDetach = w3n.mail.delivery.observeDelivery(
				idForSending, observer);
			expect(typeof cbDetach).toBe('function');
		});
		expect(notifs.length).toBeGreaterThan(0);
		const lastInfo = notifs[notifs.length-1];
		expect(typeof lastInfo).toBe('object');
		expect(lastInfo.allDone).toBe(true);
		await w3n.mail.delivery.rmMsg(idForSending);
		expect(await w3n.mail.delivery.currentState(idForSending)).toBeFalsy();
		const recInfo = lastInfo!.recipients[recipient];
		expect(typeof recInfo.idOnDelivery).toBe('string');
		expect(recInfo.err).toBeFalsy(`error when sending message to a particular recipient`);
		return recInfo.idOnDelivery!;
	}, [ app2().user.userId, txtBody, fileName ], 8);

	if (!msgId) { throw new Error(
		`got bad message id after sending: ${msgId}`); }

	// user 2 gets incoming message
	app2().c.timeouts('script', 7000);
	await execExpects(app2().c, async function(
		msgId: string, txtBody: string, fileName: string
	) {
		// check message
		const msgs = await w3n.mail.inbox.listMsgs();
		const msgInfo = msgs.find(m => (m.msgId === msgId));
		expect(msgInfo).toBeTruthy(`message ${msgId} should be present in a list of all messages`);
		const msg = await w3n.mail.inbox.getMsg(msgId);
		expect(msg).toBeTruthy();
		expect(msg.plainTxtBody).toBe(txtBody);

		// check attachments presence
		expect(!!msg.attachments).toBe(true, `attachments should be present in message ${msgId}`);
		const attachments = msg.attachments;
		if (!attachments) { throw new Error(`skipping further checks`); }

		// check file attachment
		const fileBytes = await attachments.readBytes(fileName);
		// fingerprint bytes at the end
		const endBytes = new Uint8Array(txtBody.split('').map(
			char => char.charCodeAt(0)));
		const fileEnd = fileBytes!.subarray(
			fileBytes!.length - endBytes.length);
		for (let i=0; i<fileEnd.length; i+=1) {
			if (fileEnd[i] !== endBytes[i]) {
				throw new Error(`Byte at position ${i} in the end part of an attachment is not as expected`);
			}
		}

	}, [ msgId, txtBody, fileName ], 4);

};
it.timeout = 15*1000;
specs.its.push(it);

Object.freeze(exports);