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

import { itAsync, beforeAllAsync } from '../../libs-for-tests/async-jasmine';
import { setupWithUsers } from '../../libs-for-tests/setups';
import { setRemoteJasmineInClient, checkRemoteExpectations }
	from '../../libs-for-tests/remote-js-utils';
import { AppRunner, User } from '../../libs-for-tests/app-runner';
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

// NOTE: it-specs inside signIn process expect to run in a given order -- they
//		change app's state, expected by following specs in this describe.
describe('signIn process (empty cache)', () => {

	let s = setupWithUsers();
	let app: AppRunner;
	let user: User;

	beforeAllAsync(async () => {
		app = s.apps.get(s.users[0].userId)!;
		user = app.user;
		await app.stop();
		await app.removeDataFolder();
		await app.restart();
		await setRemoteJasmineInClient(app.c);
		await setKeyDerivNotifsChecker(app.c);
	}, 30000);

	itAsync('has no users on disk', async () => {
		let exps = (await app.c.executeAsync(async function(
				userId: string, done: Function) {
			try {
				let users = await w3n.signIn.getUsersOnDisk();
				cExpect(Array.isArray(users)).toBe(true);
				cExpect(users.length).toBe(0);
			} catch (err) {
				cFail(err);
			}
			done(collectAllExpectations());
		}, user.userId)).value;
		checkRemoteExpectations(exps, 2);
	});

	itAsync(`won't startup with a wrong pass`, async () => {
		
		// start MailerId provisioning
		let exps = (await app.c.executeAsync(async function(
				userId: string, done: Function) {
			try {
				let userExists = await w3n.signIn.startLoginToRemoteStorage(userId);
				cExpect(userExists).toBe(true);
			} catch (err) {
				cFail(err);
			}
			done(collectAllExpectations());
		}, user.userId)).value;
		checkRemoteExpectations(exps, 1);

		// completing MailerId provisioning
		app.c.timeouts('script', 59000);
		exps = (await app.c.executeAsync(async function(
				pass: string, done: Function) {
			let notifications: number[] = [];
			let notifier = (p) => { notifications.push(p); }
			try {
				let ok = await w3n.signIn.completeLoginAndLocalSetup(pass, notifier);
				cExpect(ok).toBe(false, 'false should be returned for wrong pass');
				checkKeyDerivNotifications(notifications);
			} catch (err) {
				cFail(err);
			}
			done(collectAllExpectations());
		}, 'wrong password')).value;
		app.c.timeouts('script', 5000);
		checkRemoteExpectations(exps);
	}, 60000);

	itAsync('starts with correct pass', async () => {

		// start login
		let exps = (await app.c.executeAsync(async function(
				userId: string, done: Function) {
			try {
				let userExists = await w3n.signIn.startLoginToRemoteStorage(userId);
				cExpect(userExists).toBe(true);
			} catch (err) {
				cFail(err);
			}
			done(collectAllExpectations());
		}, user.userId)).value;
		checkRemoteExpectations(exps, 1);

		// complete login and a local storage setup
		app.c.timeouts('script', 59000);
		exps = (await app.c.executeAsync(async function(
				pass: string, done: Function) {
			let notifications: number[] = [];
			let notifier = (p) => { notifications.push(p); }
			try {
				let ok = await w3n.signIn.completeLoginAndLocalSetup(pass, notifier);
				cExpect(ok).toBe(true, 'indicates completion of login and storage setup');
				checkKeyDerivNotifications(notifications);
			} catch (err) {
				cFail(err);
			}
			done(collectAllExpectations());
		}, user.pass)).value;
		app.c.timeouts('script', 5000);
		await sleep(500);	// for windows switch over
		checkRemoteExpectations(exps);
	}, 60000);

	itAsync('startup objects are not injected into the second window',
		checkSecondWindow(() => app));

});