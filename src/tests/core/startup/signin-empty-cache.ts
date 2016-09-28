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

import { itAsync, fitAsync, xitAsync, afterEachAsync, beforeAllAsync }
	from '../../libs-for-tests/async-jasmine';
import { setupWithUsers, setAwaiterJS6InClient }
	from '../../libs-for-tests/setups';
import { AppRunner, User } from '../../libs-for-tests/app-runner';
import { sleep } from '../../../lib-common/processes';
import { checkKeyDerivNotifications, checkSecondWindow }
	from '../../libs-for-tests/startup';

declare var w3n: {
	signUp: Web3N.Startup.SignUpService;
	signIn: Web3N.Startup.SignInService;
}

// NOTE: it-specs inside signIn process expect to run in a given order -- they
//		change app's state, expected by following specs in this describe.
describe('signIn process (empty cache)', () => {

	let s = setupWithUsers();
	let app: AppRunner;
	let user: User;

	beforeAllAsync(async () => {
		app = s.apps.get(s.users[0].userId);
		user = app.user;
		await app.stop();
		await app.removeDataFolder();
		await app.restart();
		await setAwaiterJS6InClient(app);
	});

	itAsync('has no users on disk', async () => {
		let usersOnDisk: string[] = (await app.c.executeAsync(
		async function(done: Function) {
			let users = await w3n.signIn.getUsersOnDisk();
			done(users);
		})).value;
		expect(Array.isArray(usersOnDisk)).toBe(true);
		expect(usersOnDisk.length).toBe(0);
	});

	itAsync('won\'t setup MailerId identity with wrong pass', async () => {
		// start MailerId provisioning
		let userExists: boolean = (await app.c.executeAsync(
		async function(userId: string, done: Function) {
			let userExists = await w3n.signIn.startMidProvisioning(userId);
			done(userExists);
				
		}, user.userId)).value;
		expect(userExists).toBe(true);
		// completing MailerId provisioning
		(<any> app.c).timeouts('script', 59000);
		let r: { midDone: boolean; notifications: number[] } = (await app.c.executeAsync(async function(pass: string, done: Function) {
			let notifications: number[] = [];
			let notifier = (p) => { notifications.push(p); }
			let midDone = await w3n.signIn.completeMidProvisioning(pass, notifier);
			done({ midDone, notifications });
		}, 'wrong password')).value;
		(<any> app.c).timeouts('script', 5000);
		expect(r.midDone).toBe(false);
		checkKeyDerivNotifications(r.notifications);
	}, 60000);

	itAsync('sets up MailerId identity with correct pass', async () => {
		// start MailerId provisioning
		let userExists: boolean = (await app.c.executeAsync(
		async function(userId: string, done: Function) {
			let userExists = await w3n.signIn.startMidProvisioning(userId);
			done(userExists);
		}, user.userId)).value;
		expect(userExists).toBe(true);
		// completing MailerId provisioning
		(<any> app.c).timeouts('script', 59000);
		let r: { midDone: boolean; notifications: number[] } = (await app.c.executeAsync(async function(pass: string, done: Function) {
			let notifications: number[] = [];
			let notifier = (p) => { notifications.push(p); }
			let midDone = await w3n.signIn.completeMidProvisioning(pass, notifier);
			done({ midDone, notifications });
		}, user.midPass)).value;
		(<any> app.c).timeouts('script', 5000);
		expect(r.midDone).toBe(true);
		checkKeyDerivNotifications(r.notifications);
	}, 60000);

	itAsync('won\'t setup 3NStorage with wrong pass', async () => {
		(<any> app.c).timeouts('script', 59000);
		let r: { passOK: boolean; notifications: number[] } = (await app.c.executeAsync(async function(
					userId: string, pass: string, done: Function) {
			let notifications: number[] = [];
			let notifier = (p) => { notifications.push(p); }
			let passOK = await w3n.signIn.setupStorage(userId, pass, notifier);
			done({ passOK, notifications });
		}, user.userId, 'wrong password')).value;
		(<any> app.c).timeouts('script', 5000);
		expect(r.passOK).toBe(false);
		checkKeyDerivNotifications(r.notifications);
	}, 60000);

	itAsync('sets up 3NStorage with correct pass', async () => {
		(<any> app.c).timeouts('script', 59000);
		let r: { passOK: boolean; notifications: number[] } = (await app.c.executeAsync(async function(
					userId: string, pass: string, done: Function) {
			let notifications: number[] = [];
			let notifier = (p) => { notifications.push(p); }
			let passOK = await w3n.signIn.setupStorage(userId, pass, notifier);
			done({ passOK, notifications });
		}, user.userId, user.storePass)).value;
		(<any> app.c).timeouts('script', 5000);
		expect(r.passOK).toBe(true);
		checkKeyDerivNotifications(r.notifications);
		await sleep(500);	// for windows switch over
	}, 60000);

	itAsync('startup objects are not injected into the second window',
		checkSecondWindow(() => app));

});