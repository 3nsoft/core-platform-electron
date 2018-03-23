/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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
import { checkRemoteExpectations } from '../../../libs-for-tests/setups';
import { AppRunner } from '../../../libs-for-tests/app-runner';
import { W3N } from '../test-utils';

declare var w3n: W3N;
const cExpect = expect;
const cFail = fail;
function collectAllExpectations(): void {};

export const specs: SpecDescribe = {
	description: '.sendMsg',
	its: []
};

type DeliveryProgress = web3n.asmail.DeliveryProgress;
type OutgoingMessage = web3n.asmail.OutgoingMessage;
type ASMailSendException = web3n.asmail.ASMailSendException;

const it: SpecIt = {
	expectation: 'send message to unknown user',
	funcArgs: [ 'app1' ]
};
it.func = async function(app1: () => AppRunner) {
	const txtBody = 'Some text\nBlah-blah-blah';
	const unknownUser = `Unknown ${app1().user.userId}`;

	// user 1 sends message to user 2
	const exps = (await app1().c.executeAsync(
	async function(recipient: string, txtBody: string, done: Function) {
		try {
			const msg: OutgoingMessage = {
				msgType: 'mail',
				plainTxtBody: txtBody
			};

			// start sending
			const idForSending = 'q2w3e';
			await w3n.mail.delivery.addMsg([ recipient ], msg, idForSending);
			cExpect(await w3n.mail.delivery.currentState(idForSending)).toBeTruthy();

			// register delivery progress callback
			const notifs: DeliveryProgress[] = [];

			// observe, while waiting for delivery completion
			await new Promise((resolve, reject) => {
				const observer: web3n.Observer<DeliveryProgress> = {
					next: (p: DeliveryProgress) => { notifs.push(p); },
					complete: resolve, error: reject
				};
				const cbDetach = w3n.mail.delivery.observeDelivery(
					idForSending, observer);
				cExpect(typeof cbDetach).toBe('function');
			});

			// notifications should have something
			cExpect(notifs.length).toBeGreaterThan(0);
			const lastInfo = notifs[notifs.length-1];
			cExpect(lastInfo).toBeTruthy('There has to be at least one event fired');

			// it has to be an error
			cExpect(typeof lastInfo!.recipients[recipient].err).toBe('object');
			const exc = lastInfo!.recipients[recipient].err! as ASMailSendException;
			cExpect(exc.unknownRecipient).toBe(true);
			cExpect(typeof lastInfo!.recipients[recipient].idOnDelivery).toBe('undefined');

			await w3n.mail.delivery.rmMsg(idForSending);
			cExpect(await w3n.mail.delivery.currentState(idForSending)).toBeFalsy();
		} catch (err) {
			cFail(err);
		}
		done(collectAllExpectations());
	}, unknownUser, txtBody)).value;
	checkRemoteExpectations(exps, 8);
	
};
specs.its.push(it);

Object.freeze(exports);