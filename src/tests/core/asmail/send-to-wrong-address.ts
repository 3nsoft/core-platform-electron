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
type ASMailSendException = web3n.asmail.ASMailSendException;

let it: SpecIt = {
	expectation: 'send message to unknown user',
	funcArgs: [ 'app1' ]
};
it.func = async function(app1: () => AppRunner) {
	let txtBody = 'Some text\nBlah-blah-blah';
	let unknownUser = `Unknown ${app1().user.userId}`;

	// user 1 sends message to user 2
	let exps = (await app1().c.executeAsync(
	async function(recipient: string, txtBody: string, done: Function) {
		try {
			let msg: OutgoingMessage = {
				plainTxtBody: txtBody
			};

			// start sending
			let idForSending = 'q2w3e';
			await w3n.mail.delivery.addMsg([ recipient ], msg, idForSending);
			cExpect(await w3n.mail.delivery.currentState(idForSending)).toBeTruthy();

			// register delivery progress callback
			let notifs: DeliveryProgress[] = [];
			let cbId = await w3n.mail.delivery.registerProgressCB(idForSending,
				(p: DeliveryProgress) => { notifs.push(p); });
			cExpect(typeof cbId).toBe('number');

			// wait for completion
			let lastInfo = await w3n.mail.delivery.completionOf(idForSending);
			cExpect(typeof lastInfo).toBe('object');
			cExpect(lastInfo!.allDone).toBe(true);

			// it has to be an error
			cExpect(typeof lastInfo!.recipients[recipient].err).toBe('object');
			let exc = lastInfo!.recipients[recipient].err! as ASMailSendException;
			cExpect(exc.unknownRecipient).toBe(true);
			cExpect(typeof lastInfo!.recipients[recipient].idOnDelivery).toBe('undefined');

			// notifications should have something
			cExpect(notifs.length).toBeGreaterThan(0);

			await w3n.mail.delivery.rmMsg(idForSending);
			cExpect(await w3n.mail.delivery.currentState(idForSending)).toBeFalsy();
		} catch (err) {
			cFail(err);
		}
		done(collectAllExpectations());
	}, unknownUser, txtBody)).value;
	// checkRemoteExpectations(exps, 7);
	
};
specs.its.push(it);

Object.freeze(exports);