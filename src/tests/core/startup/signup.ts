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

import { itAsync, beforeAllAsync } from '../../libs-for-tests/async-jasmine';
import { minimalSetup } from '../../libs-for-tests/setups';
import { setAwaiterJS6InClient, setRemoteJasmineInClient,
	checkRemoteExpectations }
	from '../../libs-for-tests/remote-js-utils';
import { sleep } from '../../../lib-common/processes';
import { checkSecondWindow, setKeyDerivNotifsChecker }
	from '../../libs-for-tests/startup';

declare var w3n: {
	signUp: web3n.startup.SignUpService;
	signIn: web3n.startup.SignInService;
}
declare var cExpect: typeof expect;
declare var cFail: typeof fail;
declare function collectAllExpectations(): void;
declare function checkKeyDerivNotifications(notifPerc: number[]): void;

// NOTE: it-specs inside signUp process expect to run in a given order -- they
//		change app's state, expected by following specs in this describe.
describe('signUp process', () => {

	let s = minimalSetup();

	beforeAllAsync(async () => {
		await setAwaiterJS6InClient(s.app.c);
		await setRemoteJasmineInClient(s.app.c);
		await setKeyDerivNotifsChecker(s.app.c);
	});

	let name = 'Mike Marlow ';
	let pass = 'some long passphrase';

	itAsync('gets available addresses', async () => {
		let exps = (await s.c.executeAsync(async function(
				name: string, signupDomains: string[], done: Function) {
			try {
				let addresses = await w3n.signUp.getAvailableAddresses(name);
				cExpect(Array.isArray(addresses)).toBe(true);
				cExpect(addresses.length).toBe(signupDomains.length);
				for (let d of signupDomains) {
					cExpect(addresses).toContain(`${name}@${d}`);
				}
			} catch (err) {
				cFail(err);
			}
			done(collectAllExpectations());
		}, name, s.signupDomains)).value;
		checkRemoteExpectations(exps, 2 + s.signupDomains.length);
	});

	itAsync('creates User parameters', async () => {
		(s.c as any).timeouts('script', 59000);
		let exps = (await s.c.executeAsync(async function(
				pass: string, done: Function) {
			let notifications: number[] = [];
			let notifier = (p) => { notifications.push(p); }
			try {
				await w3n.signUp.createUserParams(pass, notifier);
				checkKeyDerivNotifications(notifications);
			} catch (err) {
				cFail(err);
			}
			done(collectAllExpectations());
		}, pass)).value;
		(s.c as any).timeouts('script', 5000);
		checkRemoteExpectations(exps);
	}, 60000);

	itAsync('creates user account', async () => {
		let userId = `${name}@${s.signupDomains[0]}`;
		let exps = (await s.c.executeAsync(async function(
				userId: string, done: Function) {
			try {
				let isCreated = await w3n.signUp.addUser(userId);
				cExpect(isCreated).toBe(true);
			} catch (err) {
				cFail(err);
			}
			done(collectAllExpectations());
		}, userId)).value;
		checkRemoteExpectations(exps, 1);
		await sleep(2000);
	});

	itAsync('startup objects are not injected into the second window',
		checkSecondWindow(() => s.app));

});