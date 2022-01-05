/*
 Copyright (C) 2017 - 2018, 2020 - 2021 3NSoft Inc.
 
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

import { SpecDescribe } from '../../libs-for-tests/spec-module.js';
import { askSecondUserToSendMsg } from '../second-user.js';
import { SpecIt } from '../test-utils.js';

export const specs: SpecDescribe = {
	description: '.subscribe',
	its: []
};

type OutgoingMessage = web3n.asmail.OutgoingMessage;
type IncomingMessage = web3n.asmail.IncomingMessage;

const it: SpecIt = {
	expectation: `delivers new messages to listeners of event 'message'`
};
it.func = async function(s) {

	// subscribe to message
	const msgFromSub = new Promise<IncomingMessage>((resolve, reject) => {
		const unsub = w3n.mail!.inbox.subscribe('message', {
			next: msg => {
				unsub();
				resolve(msg);
			},
			error: reject
		});
	});

	const outMsg: OutgoingMessage = {
		msgType: 'mail',
		plainTxtBody: `Some text\nBlah-blah-blah\nEpoch moment ${Date.now()}`
	};

	await askSecondUserToSendMsg(outMsg);

	const inMsg = await msgFromSub;
	expect(inMsg.msgId).toBeDefined();
	expect(inMsg.sender).toBe(s.secondUser);
	expect(inMsg.msgType).toBe(outMsg.msgType);
	expect(inMsg.plainTxtBody).toBe(outMsg.plainTxtBody);

};
specs.its.push(it);

export const secondUserTasks = [];
