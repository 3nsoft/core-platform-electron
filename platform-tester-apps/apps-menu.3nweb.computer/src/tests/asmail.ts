/*
 Copyright (C) 2016, 2018, 2020 - 2021 3NSoft Inc.
 
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

import { itCond } from './libs-for-tests/jasmine-utils.js';
import { loadSpecs } from './libs-for-tests/spec-module.js';
import { SetupForASMail } from './asmail/test-utils.js';
import { areAddressesEqual } from '../lib-common/canonical-address.js';
import { specs } from './asmail/specs/index.js';
import { getTestUsersOrdered } from '../test-page-utils.js';

type WritableFS = web3n.files.WritableFS;

describe('ASMail', () => {

	const s = {} as SetupForASMail;
	const testFolderName = `ASMail tests, ${Date.now()}`;
	let appFS: WritableFS;

	beforeAll(async () => {
		s.users = await getTestUsersOrdered();
		appFS = await w3n.storage!.getAppLocalFS();
		s.testFolder = await appFS.writableSubRoot(testFolderName);
		s.isUp = true;
	});

	afterAll(async () => {
		await appFS.deleteFolder(testFolderName, true);
		s.isUp = false;
	});

	itCond('mail is present in common CAPs', async () => {
		expect(typeof w3n.mail).toBe('object');
		expect(typeof w3n.mail!.delivery).toBe('object');
		expect(typeof w3n.mail!.inbox).toBe('object');
		expect(typeof w3n.mail!.getUserId).toBe('function');
	}, undefined, s);

	itCond('gets current user id', async () => {
		const userId = await w3n.mail!.getUserId();
		expect(areAddressesEqual(userId, s.users[0])).toBeTrue();
	}, undefined, s);

	itCond('lists incoming messages in the inbox', async () => {
		const msgs = await w3n.mail!.inbox.listMsgs();
		expect(Array.isArray(msgs)).toBe(true);
	}, undefined, s);

	loadSpecs(
		s,
		specs,
		[ 'big-msg-allowance' ]);

});