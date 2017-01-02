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

export let specs: SpecDescribe = {
	description: '.sendMsg',
	its: []
};

type DeliveryProgress = web3n.asmail.DeliveryProgress;
type OutgoingMessage = web3n.asmail.OutgoingMessage;

let it: SpecIt = {
	expectation: 'send message to existing address and get it',
	funcArgs: [ 'app1', 'app2' ]
};
it.func = async function(app1: () => AppRunner, app2: () => AppRunner) {
	let txtBody = 'Some text\nBlah-blah-blah';

	// user 1 sends message to user 2
	let v: { msgId: string; exps: any; } = (await app1().c.executeAsync(
	async function(recipient: string, txtBody: string, done: Function) {
		let msgId: string = (undefined as any);
		try {
			let msg: OutgoingMessage = {
				plainTxtBody: txtBody
			};
			let idForSending = 'a4b5';
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
	}, app2().user.userId, txtBody)).value;
	checkRemoteExpectations(v.exps, 7);
	
	// user 2 gets incoming message
	let exps = (await app2().c.executeAsync(
	async function(msgId: string, txtBody: string, done: Function) {
		try {
			if (!msgId) { throw new Error(
				`got bad message id after sending: ${msgId}`); }
			let msgs = await w3n.mail.inbox.listMsgs();
			let msgInfo = msgs.find(m => (m.msgId === msgId));
			cExpect(msgInfo).toBeTruthy(`message ${msgId} should be present in a list of all messages`);
			let msg = await w3n.mail.inbox.getMsg(msgId);
			cExpect(msg).toBeTruthy();
			cExpect(msg.plainTxtBody).toBe(txtBody);
		} catch (err) {
			cFail(err);
		}
		done(collectAllExpectations());
	}, v.msgId, txtBody)).value;
	checkRemoteExpectations(exps, 3);
	
};
specs.its.push(it);

Object.freeze(exports);