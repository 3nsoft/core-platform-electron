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
import { minimalSetup, setAwaiterJS6InClient }
	from '../../libs-for-tests/setups';
import { sleep } from '../../../lib-common/processes';
import { checkKeyDerivNotifications, checkSecondWindow }
	from '../../libs-for-tests/startup';

declare var w3n: {
	signUp: Web3N.Startup.SignUpService;
	signIn: Web3N.Startup.SignInService;
}

// NOTE: it-specs inside signUp process expect to run in a given order -- they
//		change app's state, expected by following specs in this describe.
describe('signUp process', () => {

	let s = minimalSetup();

	beforeAllAsync(async () => {
		await setAwaiterJS6InClient(s.app);
	});

	let name = 'Mike Marlow ';
	let pass = 'some long passphrase';

	itAsync('gets available addresses', async () => {
		let addresses: string[] = (await s.c.executeAsync(
		async function(name: string, done: Function) {
			let addresses = await w3n.signUp.getAvailableAddresses(name);
			done(addresses);
		}, name)).value;
		expect(Array.isArray(addresses)).toBe(true);
		expect(addresses.length).toBe(s.signupDomains.length);
		for (let d of s.signupDomains) {
			expect(addresses).toContain(`${name}@${d}`);
		}
	});

	itAsync('creates MailerId parameters', async () => {
		(<any> s.c).timeouts('script', 59000);
		let notifPerc: number[] = (await s.c.executeAsync(
		async function(pass: string, done: Function) {
			let notifications: number[] = [];
			let notifier = (p) => { notifications.push(p); }
			await w3n.signUp.createMailerIdParams(pass, notifier);
			done(notifications);
		}, pass)).value;
		(<any> s.c).timeouts('script', 5000);
		// although, function returns noting, key derivation notifications are
		// needed for UI display
		checkKeyDerivNotifications(notifPerc);
	}, 60000);

	itAsync('creates Storage parameters', async () => {
		(<any> s.c).timeouts('script', 59000);
		let notifPerc: number[] = (await s.c.executeAsync(
		async function(pass: string, done: Function) {
			let notifications: number[] = [];
			let notifier = (p) => { notifications.push(p); }
			await w3n.signUp.createStorageParams(pass, notifier);
			done(notifications);
		}, pass)).value;
		(<any> s.c).timeouts('script', 5000);
		// although, function returns noting, key derivation notifications are
		// needed for UI display
		checkKeyDerivNotifications(notifPerc);
	}, 60000);

	itAsync('creates user account', async () => {
		let userId = `${name}@${s.signupDomains[0]}`;
		let isCreated: boolean = (await s.c.executeAsync(
		async function(userId: string, done: Function) {
			let isCreated = await w3n.signUp.addUser(userId);
			done(isCreated);
		}, userId)).value;
		expect(isCreated).toBe(true);
		await sleep(2000);
	});

	itAsync('startup objects are not injected into the second window',
		checkSecondWindow(() => s.app));

});