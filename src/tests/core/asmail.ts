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

import { itAsync, fitAsync, xitAsync, beforeAllAsync }
	from '../libs-for-tests/async-jasmine';
import { setupWithUsers, checkRemoteExpectations }
	from '../libs-for-tests/setups';
import { AppRunner } from '../libs-for-tests/app-runner';
import { stringOfB64Chars } from '../../lib-client/random-node';
import { specsWithArgs } from '../libs-for-tests/spec-module';
import { resolve } from 'path';

declare var w3n: {
	mail: web3n.asmail.Service;
	storage: web3n.storage.Service;
	device: {
		openFileDialog: typeof web3n.device.files.openFileDialog;
		saveFileDialog: typeof web3n.device.files.saveFileDialog;
	};
}
declare var cExpect: typeof expect;
declare var cFail: typeof fail;
declare function collectAllExpectations(): void;

describe('ASMail', () => {

	let s = setupWithUsers(
		[ 'Bob Perkins @company.inc', 'John Morrison @bank.com' ]);
	let app1: AppRunner;
	let app2: AppRunner;

	beforeAllAsync(async () => {
		app1 = s.apps.get(s.users[0].userId)!;
		app2 = s.apps.get(s.users[1].userId)!;
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
			let msgs = await w3n.mail.inbox.listMsgs();
			cExpect(Array.isArray(msgs)).toBe(true);
			cExpect(msgs.length).toBe(0);
			done(collectAllExpectations());
		})).value;
		checkRemoteExpectations(exps, 2);
	});

	specsWithArgs(resolve(__dirname, './asmail'), {
		s: () => s,
		app1: () => app1,
		app2: () => app2,
	});

});