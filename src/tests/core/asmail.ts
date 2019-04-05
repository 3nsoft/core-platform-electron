/*
 Copyright (C) 2016, 2018 3NSoft Inc.
 
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

import { itAsync, beforeAllAsync }
	from '../libs-for-tests/async-jasmine';
import { setupWithUsers, execExpects } from '../libs-for-tests/setups';
import { AppRunner } from '../libs-for-tests/app-runner';
import { specsWithArgs } from '../libs-for-tests/spec-module';
import { resolve } from 'path';

declare var w3n: {
	mail: web3n.asmail.Service;
	storage: web3n.storage.Service;
	device: {
		openFileDialog: web3n.device.files.OpenFileDialog;
		saveFileDialog: web3n.device.files.SaveFileDialog;
	};
}

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
		await execExpects(app1.c, async function(expUserId: string) {
			let userId = await w3n.mail.getUserId();
			expect(userId).toBe(expUserId);
		}, [ app1.user.userId ], 1);
	});

	itAsync('lists incoming messages (no messages)', async () => {
		await execExpects(app1.c, async function() {
			let msgs = await w3n.mail.inbox.listMsgs();
			expect(Array.isArray(msgs)).toBe(true);
			expect(msgs.length).toBe(0);
		}, [], 2);
	});

	specsWithArgs(resolve(__dirname, './asmail/specs'), {
		s: () => s,
		app1: () => app1,
		app2: () => app2,
	});

});