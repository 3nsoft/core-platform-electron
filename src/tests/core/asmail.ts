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

import { itAsync, fitAsync, xitAsync, afterEachAsync, beforeAllAsync }
	from '../libs-for-tests/async-jasmine';
import { setupWithUsers, setAwaiterJS6InClient, checkRemoteExpectations,
	setRemoteJasmineInClient } from '../libs-for-tests/setups';
import { AppRunner, User } from '../libs-for-tests/app-runner';
import { sleep } from '../../lib-common/processes';

declare var w3n: {
	mail: Web3N.ASMail.Service;
	storage: Web3N.Storage.Service;
	device: {
		openFileDialog: typeof Web3N.Device.Files.openFileDialog;
		saveFileDialog: typeof Web3N.Device.Files.saveFileDialog;
	};
}
declare var cExpect: typeof expect;
declare var cFail: typeof fail;
declare function collectAllExpectations(): void;

// NOTE: it-specs inside signIn process should run in a given order, as they
//		change app's state, which may be expected by following specs.
describe('ASMail', () => {

	let s = setupWithUsers(
		[ 'Bob Perkins @company.inc', 'John Morrison @bank.com' ]);
	let app1: AppRunner;
	let app2: AppRunner;

	beforeAllAsync(async () => {
		app1 = s.apps.get(s.users[0].userId);
		await setRemoteJasmineInClient(app1);
		await setAwaiterJS6InClient(app1);
		app2 = s.apps.get(s.users[1].userId);
		await setRemoteJasmineInClient(app2);
		await setAwaiterJS6InClient(app2);
	});
	
	itAsync('api object is injected', async () => {
		let t: string[] = (await app1.c.execute(function() {
			return typeof w3n.mail;
		})).value;
		expect(t).toBe('object');
	});

	itAsync('gets current user id', async () => {
		let exps = (await app1.c.executeAsync(
		async function(expUserId: string, done: Function) {
			let userId = await w3n.mail.getUserId();
			cExpect(userId).toBe(expUserId);
			done(collectAllExpectations());
		}, app1.user.userId)).value;
		checkRemoteExpectations(exps, 1);
	});

	itAsync('lists incoming messages (no messages)', async () => {
		let exps = (await app1.c.executeAsync(
		async function(done: Function) {
			let msgs = await w3n.mail.listMsgs();
			cExpect(Array.isArray(msgs)).toBe(true);
			cExpect(msgs.length).toBe(0);
			done(collectAllExpectations());
		})).value;
		checkRemoteExpectations(exps, 2);
	});

	itAsync('send message to existing address and get it', async () => {
		let txtBody = 'Some text\nBlah-blah-blah';

		// user 1 sends message to user 2
		let msgId: string = (await app1.c.executeAsync(
		async function(recipient: string, txtBody: string, done: Function) {
			let msg: Web3N.ASMail.OutgoingMessage = {
				plainTxtBody: txtBody
			};
			let msgId = await w3n.mail.sendMsg(recipient, msg);
			done(msgId);
		}, app2.user.userId, txtBody)).value;
		
		// user 2 gets incoming message
		let exps = (await app2.c.executeAsync(
		async function(msgId: string, txtBody: string, done: Function) {
			let msgs = await w3n.mail.listMsgs();
			let msgInfo = msgs.find(m => (m.msgId === msgId));
			cExpect(msgInfo).toBeTruthy(`message ${msgId} should be present in a list of all messages`);
			let msg = await w3n.mail.getMsg(msgId);
			cExpect(msg).toBeTruthy();
			cExpect(msg.plainTxtBody).toBe(txtBody);
			done(collectAllExpectations());
		}, msgId, txtBody)).value;
		checkRemoteExpectations(exps, 3);

	});

	xitAsync('sending and getting message with an attachment', async () => {

		// XXX need a Uint8Array to FileObject contructor or working storage FS

	})

});