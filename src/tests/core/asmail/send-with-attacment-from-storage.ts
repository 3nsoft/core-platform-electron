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

import { SpecDescribe, SpecIt } from '../../libs-for-tests/spec-module';
import { checkRemoteExpectations } from '../../libs-for-tests/setups';
import { AppRunner } from '../../libs-for-tests/app-runner';
import { stringOfB64Chars } from '../../../lib-client/random-node';

declare var w3n: {
	mail: web3n.asmail.Service;
	storage: web3n.storage.Service;
	device: {
		openFileDialog: typeof web3n.device.files.openFileDialog;
		saveFileDialog: typeof web3n.device.files.saveFileDialog;
	};
}
let cExpect = expect;
let cFail = fail;
function collectAllExpectations(): void {};

type FS = web3n.storage.FS;
type File = web3n.storage.File;

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
	content: 'Content for file #2 (longer file)\n'+stringOfB64Chars(100000),
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

export let specs: SpecDescribe = {
	description: '.sendMsg',
	its: []
};

let it: SpecIt = {
	expectation: 'sending and getting message with attachments from synced fs, passed via container',
	funcArgs: [ 'app1', 'app2' ]
};
it.func = async function(app1: () => AppRunner, app2: () => AppRunner) {
	let txtBody = 'Some text\nBlah-blah-blah';

	// user 1 sends message to user 2
	let v: { msgId: string; exps: any; } = (await app1().c.executeAsync(
	async function(recipient: string, txtBody: string, files: FileParams[],
			folder: FolderParams, done: Function) {
		let msgId: string = (undefined as any);
		try {
			// make fs objects for attachment
			let appFS = await w3n.storage.getAppSyncedFS('computer.3nweb.test');
			let filesToAttach: File[] = [];
			for (let fp of files) {
				let path = fp.name;
				await appFS.writeTxtFile(path, fp.content);
				let file = await appFS.readonlyFile(path);
				filesToAttach.push(file);
			}
			let makeFolderIn = async (parent: FS, folder: FolderParams):
					Promise<FS> => {
				let fs = await parent.writableSubRoot(folder.name);
				for (let fp of folder.files) {
					await fs.writeTxtFile(fp.name, fp.content);
				}
				for (let fp of folder.folders) {
					await makeFolderIn(fs, fp);
				}
				return fs;
			};
			let folderToAttach = await makeFolderIn(appFS, folder);

			// put together and send message
			let msg: OutgoingMessage = {
				plainTxtBody: txtBody
			};
			msg.attachments = w3n.mail.makeAttachmentsContainer();
			for (let file of filesToAttach) {
				msg.attachments.addFile(file);
			}
			msg.attachments.addFolder(folderToAttach);
			let idForSending = 'a1b2';
			await w3n.mail.delivery.addMsg([ recipient ], msg, idForSending);
			cExpect(await w3n.mail.delivery.currentState(idForSending)).toBeTruthy();
			let notifs: DeliveryProgress[] = [];
			let cbId = await w3n.mail.delivery.registerProgressCB(idForSending,
				(p: DeliveryProgress) => { notifs.push(p); });
			cExpect(typeof cbId).toBe('number');
			let lastInfo = await w3n.mail.delivery.completionOf(idForSending);
			cExpect(notifs.length).toBeGreaterThan(0);
			cExpect(typeof lastInfo).toBe('object');
			cExpect(lastInfo!.allDone).toBe(true);
			await w3n.mail.delivery.rmMsg(idForSending);
			cExpect(await w3n.mail.delivery.currentState(idForSending)).toBeFalsy();
			msgId = lastInfo!.recipients[recipient].idOnDelivery!;
			cExpect(typeof msgId).toBe('string');
		} catch (err) {
			cFail(err);
		}
		done({ msgId, exps: collectAllExpectations() });
	}, app2().user.userId, txtBody, files, folder)).value;
	checkRemoteExpectations(v.exps, 7);
	
	// user 2 gets incoming message
	let exps = (await app2().c.executeAsync(
	async function(msgId: string, txtBody: string, files: FileParams[],
			folder: FolderParams, done: Function) {
		try {
			if (!msgId) { throw new Error(
				`got bad message id after sending: ${msgId}`); }

			// check message
			let msgs = await w3n.mail.inbox.listMsgs();
			let msgInfo = msgs.find(m => (m.msgId === msgId));
			cExpect(msgInfo).toBeTruthy(`message ${msgId} should be present in a list of all messages`);
			let msg = await w3n.mail.inbox.getMsg(msgId);
			cExpect(msg).toBeTruthy();
			cExpect(msg.plainTxtBody).toBe(txtBody);

			// check attachments presence
			cExpect(!!msg.attachments).toBe(true, `attachments should be present in message ${msgId}`);
			let attachments = msg.attachments;
			if (!attachments) { throw new Error(`skipping further checks`); }

			// check files in attachments
			for (let fp of files) {
				cExpect(await attachments.readTxtFile(fp.name)).toBe(fp.content, `file content should be exactly what has been sent`);
			}

			// check folder in attachments
			let checkFolderIn = async (parent: FS, params: FolderParams) => {
				cExpect(await parent.checkFolderPresence(params.name)).toBe(true, `folder ${params.name} should be present in ${parent.name}`);
				let fs = await parent.readonlySubRoot(params.name);
				for (let fp of params.files) {
					cExpect(await fs.readTxtFile(fp.name)).toBe(fp.content, `file content should be exactly what has been sent`);
				}
				for (let fp of params.folders) {
					await checkFolderIn(fs, fp);
				}				
			};
			await checkFolderIn(attachments, folder);

		} catch (err) {
			cFail(err);
		}
		done(collectAllExpectations());
	}, v.msgId, txtBody, files, folder)).value;
	checkRemoteExpectations(exps, 4 + 2 + 6);

};
specs.its.push(it);

it = {
	expectation: 'sending and getting message with attachments from synced fs, passed via fs',
	funcArgs: [ 'app1', 'app2' ]
};
it.func = async function(app1: () => AppRunner, app2: () => AppRunner) {
	let txtBody = 'Some text\nBlah-blah-blah';

	// user 1 sends message to user 2
	let v: { msgId: string; exps: any; } = (await app1().c.executeAsync(
	async function(recipient: string, txtBody: string, files: FileParams[],
			folder: FolderParams, done: Function) {
		let msgId: string = (undefined as any);
		try {
			// make attachmentFS
			let appFS = await w3n.storage.getAppSyncedFS('computer.3nweb.test');
			let attachmentsFS = await appFS.writableSubRoot(
				'folder with attachments');
			for (let fp of files) {
				await attachmentsFS.writeTxtFile(fp.name, fp.content);
			}
			let makeFolderIn = async (parent: FS, folder: FolderParams):
					Promise<void> => {
				let fs = await parent.writableSubRoot(folder.name);
				for (let fp of folder.files) {
					await fs.writeTxtFile(fp.name, fp.content);
				}
				for (let fp of folder.folders) {
					await makeFolderIn(fs, fp);
				}
			};
			await makeFolderIn(attachmentsFS, folder);

			// put together and send message
			let msg: OutgoingMessage = {
				plainTxtBody: txtBody
			};
			msg.attachmentsFS = attachmentsFS;
			let idForSending = 'a2b3';
			await w3n.mail.delivery.addMsg([ recipient ], msg, idForSending);
			cExpect(await w3n.mail.delivery.currentState(idForSending)).toBeTruthy();
			let notifs: DeliveryProgress[] = [];
			let cbId = await w3n.mail.delivery.registerProgressCB(idForSending,
				(p: DeliveryProgress) => { notifs.push(p); });
			cExpect(typeof cbId).toBe('number');
			let lastInfo = await w3n.mail.delivery.completionOf(idForSending);
			cExpect(notifs.length).toBeGreaterThan(0);
			cExpect(typeof lastInfo).toBe('object');
			cExpect(lastInfo!.allDone).toBe(true);
			await w3n.mail.delivery.rmMsg(idForSending);
			cExpect(await w3n.mail.delivery.currentState(idForSending)).toBeFalsy();
			msgId = lastInfo!.recipients[recipient].idOnDelivery!;
			cExpect(typeof msgId).toBe('string');
		} catch (err) {
			cFail(err);
		}
		done({ msgId, exps: collectAllExpectations() });
	}, app2().user.userId, txtBody, files, folder)).value;
	checkRemoteExpectations(v.exps, 7);
	
	// user 2 gets incoming message
	let exps = (await app2().c.executeAsync(
	async function(msgId: string, txtBody: string, files: FileParams[],
			folder: FolderParams, done: Function) {
		try {
			if (!msgId) { throw new Error(
				`got bad message id after sending: ${msgId}`); }

			// check message
			let msgs = await w3n.mail.inbox.listMsgs();
			let msgInfo = msgs.find(m => (m.msgId === msgId));
			cExpect(msgInfo).toBeTruthy(`message ${msgId} should be present in a list of all messages`);
			let msg = await w3n.mail.inbox.getMsg(msgId);
			cExpect(msg).toBeTruthy();
			cExpect(msg.plainTxtBody).toBe(txtBody);

			// check attachments presence
			cExpect(!!msg.attachments).toBe(true, `attachments should be present in message ${msgId}`);
			let attachments = msg.attachments;
			if (!attachments) { throw new Error(`skipping further checks`); }

			// check files in attachments
			for (let fp of files) {
				cExpect(await attachments.readTxtFile(fp.name)).toBe(fp.content, `file content should be exactly what has been sent`);
			}

			// check folder in attachments
			let checkFolderIn = async (parent: FS, params: FolderParams) => {
				cExpect(await parent.checkFolderPresence(params.name)).toBe(true, `folder ${params.name} should be present in ${parent.name}`);
				let fs = await parent.readonlySubRoot(params.name);
				for (let fp of params.files) {
					cExpect(await fs.readTxtFile(fp.name)).toBe(fp.content, `file content should be exactly what has been sent`);
				}
				for (let fp of params.folders) {
					await checkFolderIn(fs, fp);
				}				
			};
			await checkFolderIn(attachments, folder);

		} catch (err) {
			cFail(err);
		}
		done(collectAllExpectations());
	}, v.msgId, txtBody, files, folder)).value;
	checkRemoteExpectations(exps, 4 + 2 + 6);

};
specs.its.push(it);

Object.freeze(exports);