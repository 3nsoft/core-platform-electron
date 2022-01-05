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

import { addMsgToPage, progressOnPage } from "./test-page-utils.js";

declare var w3n: web3n.testing.StartupW3N;

// NOTE: it-specs inside signUp process expect to run in a given order -- they
//		change app's state, expected by following specs in this describe.
describe('Startup process', () => {

	let creds: { userId: string; pass: string; };
	let name: string;
	let userExists: boolean;

	beforeAll(async () => {
		creds = await w3n.testStand.staticTestInfo()
		name = creds.userId.substring(0, creds.userId.indexOf('@'));
	});

	it(`uses w3n with startup services`, async () => {

		expect(typeof w3n.signIn).toBe('object');
		expect(typeof w3n.signIn.completeLoginAndLocalSetup).toBe('function');
		expect(typeof w3n.signIn.getUsersOnDisk).toBe('function');
		expect(typeof w3n.signIn.startLoginToRemoteStorage).toBe('function');
		expect(typeof w3n.signIn.useExistingStorage).toBe('function');

		expect(typeof w3n.signUp).toBe('object');
		expect(typeof w3n.signUp.addUser).toBe('function');
		expect(typeof w3n.signUp.createUserParams).toBe('function');
		expect(typeof w3n.signUp.getAvailableAddresses).toBe('function');
		expect(typeof w3n.signUp.isActivated).toBe('function');

	});

	it('knows users on disk cache', async () => {
		const users = await w3n.signIn.getUsersOnDisk();
		expect(Array.isArray(users)).toBe(true);
	});

	it('gets available addresses, checking if user is created', async () => {
		const addresses = await w3n.signUp.getAvailableAddresses(name);
		expect(Array.isArray(addresses)).toBe(true);
		userExists = !addresses.find(addr => (addr === creds.userId));
	});

	it('creates new user or signs in existing one', async () => {
		let prevP: number|undefined = undefined;
		const notifier = (p: number) => {
			if (prevP != undefined) {
				expect(p).toBeGreaterThan(prevP);
			}
			prevP = p;
			progressOnPage(p);
		};

		if (userExists === undefined) {
			throw new Error(`userExists is not set`);
		} else if (userExists) {
			addMsgToPage(`User already exists, and signin process is tested`);

			const users = await w3n.signIn.getUsersOnDisk();
			if (users.find(addr => (addr === creds.userId))) {
				addMsgToPage(`User files are present on a disk.`);

				addMsgToPage(`Checking reaction to wrong password.`);
				let passOK = await w3n.signIn.useExistingStorage(
					creds.userId, 'wrong password', notifier);
				expect(passOK).withContext(
					`wrong pass should be rejected`).toBe(false);
				prevP = undefined;

				addMsgToPage(`Using correct password.`);
				passOK = await w3n.signIn.useExistingStorage(
					creds.userId, creds.pass, notifier);
				expect(passOK).toBe(true);

			} else {
				addMsgToPage(`Disk cache doesn't have user files.`);
				const userExists = await w3n.signIn.startLoginToRemoteStorage(
					creds.userId);
				expect(userExists).toBe(true);

				addMsgToPage(`Checking reaction to wrong password.`);
				let passOK = await w3n.signIn.completeLoginAndLocalSetup(
					'wrong password', notifier);
				expect(passOK).withContext(
					`wrong pass should be rejected`).toBe(false);
				prevP = undefined;

				addMsgToPage(`Using correct password.`);
				await w3n.signIn.startLoginToRemoteStorage(creds.userId);
				passOK = await w3n.signIn.completeLoginAndLocalSetup(
					creds.pass, notifier);
				expect(passOK).toBe(true);

			}

		} else {
			addMsgToPage(`User doesn't exist, and signup process is tested`);
			await w3n.signUp.createUserParams(creds.pass, notifier);
			const isCreated = await w3n.signUp.addUser(creds.userId);
			expect(isCreated).toBe(true);	

		}

		// platform will quickly close startup app

	}, 90000);

});
