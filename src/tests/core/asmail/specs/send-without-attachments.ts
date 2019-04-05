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
import { execExpects } from '../../../libs-for-tests/setups';
import { AppRunner } from '../../../libs-for-tests/app-runner';
import { W3N } from '../test-utils';

declare var w3n: W3N;

export const specs: SpecDescribe = {
	description: '.sendMsg',
	its: []
};

type DeliveryProgress = web3n.asmail.DeliveryProgress;
type OutgoingMessage = web3n.asmail.OutgoingMessage;

const it: SpecIt = {
	expectation: 'send message to existing address and get it',
	funcArgs: [ 'app1', 'app2' ]
};
it.func = async function(app1: () => AppRunner, app2: () => AppRunner) {
	const txtBody = 'Some text\nBlah-blah-blah';
	const jsonBody = {
		field1: 123,
		field2: 'blah-blah'
	};

	// user 1 sends message to user 2
	const msgId = await execExpects(app1().c, async function(recipient: string,
			txtBody: string, jsBody: typeof jsonBody) {
		const msg: OutgoingMessage = {
			msgType: 'mail',
			plainTxtBody: txtBody,
			jsonBody: jsBody
		};
		const idForSending = 'a4b5';
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
	}, [ app2().user.userId, txtBody, jsonBody ], 8);

	if (!msgId) { throw new Error(
		`got bad message id after sending: ${msgId}`); }
	
	// user 2 gets incoming message
	await execExpects(app2().c, async function(msgId: string, txtBody: string,
			jsBody: typeof jsonBody) {
		const msgs = await w3n.mail.inbox.listMsgs();
		const msgInfo = msgs.find(m => (m.msgId === msgId));
		expect(msgInfo).toBeTruthy(`message ${msgId} should be present in a list of all messages`);
		const msg = await w3n.mail.inbox.getMsg(msgId);
		expect(msg).toBeTruthy();
		expect(msg.plainTxtBody).toBe(txtBody);
		expect(msg.jsonBody).toBeTruthy();
		expect((msg.jsonBody as typeof jsonBody).field1).toBe(jsBody.field1);
		expect((msg.jsonBody as typeof jsonBody).field2).toBe(jsBody.field2);
	}, [ msgId, txtBody, jsonBody ], 6);
	
};
specs.its.push(it);

Object.freeze(exports);