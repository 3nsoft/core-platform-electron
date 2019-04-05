/*
 Copyright (C) 2017 - 2018 3NSoft Inc.
 
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
import { sendTxtMsg, sendTxtMsgNumOfChecks, W3N } from '../test-utils';

declare var w3n: W3N;

export const specs: SpecDescribe = {
	description: '.subscribe',
	its: []
};

type IncomingMessage = web3n.asmail.IncomingMessage;

const it: SpecIt = {
	expectation: `delivers new messages to listeners of event 'message'`,
	funcArgs: [ 'app1', 'app2' ]
};
it.func = async function(app1: () => AppRunner, app2: () => AppRunner) {
	// user 2 starts listening for events, collecting 'em in window-places array
	await execExpects(app2().c, async function() {
		const testMessages: IncomingMessage[] = [];
		(window as any).testMessages = new Promise((resolve, reject) => {
			w3n.mail.inbox.subscribe('message', {
				next: (msg) => {
					testMessages.push(msg);
					// promise will resolve when at least two messages come
					if (testMessages.length >= 2) { resolve(testMessages); }
				},
				error: reject
			});
		});
	});

	const txtBody1 = 'Some text\nBlah-blah-blah';
	const txtBody2 = 'Another text message';

	// user 1 sends message to user 2
	const msgId1 = await execExpects(app1().c, sendTxtMsg, [ app2().user.userId, txtBody1 ], sendTxtMsgNumOfChecks);
	const msgId2 = await execExpects(app1().c, sendTxtMsg, [ app2().user.userId, txtBody2 ], sendTxtMsgNumOfChecks);

	if (!msgId1) { throw new Error(
		`got bad message id after sending: ${msgId1}`); }
	
	// user 2 gets incoming message
	await execExpects(app2().c, async function(idAndTxts: string[][]) {
		const testMessages: IncomingMessage[] =
			await (window as any).testMessages;
		for (const idAndTxt of idAndTxts) {
			const msgId = idAndTxt[0];
			const txtBody = idAndTxt[1];
			const msg = testMessages.find(m => (m.msgId === msgId));
			expect(msg).toBeTruthy(`message ${msgId} should be present in a list of all messages`);
			expect(msg!.plainTxtBody).toBe(txtBody);
		}
	}, [ [[ msgId1, txtBody1 ], [ msgId2, txtBody2 ]] ], 4);
	
};
specs.its.push(it);

Object.freeze(exports);