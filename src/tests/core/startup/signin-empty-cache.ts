/*
 Copyright (C) 2016 - 2018 3NSoft Inc.
 
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
import { setRemoteJasmineInClient, execExpects }
	from '../../libs-for-tests/remote-js-utils';
import { AppRunner, User } from '../../libs-for-tests/app-runner';
import { sleep } from '../../../lib-common/processes';
import { checkSecondWindow, setKeyDerivNotifsChecker }
	from '../../libs-for-tests/startup';

declare var w3n: {
	signUp: web3n.startup.SignUpService;
	signIn: web3n.startup.SignInService;
}
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
		await execExpects(app.c, async function() {
			let users = await w3n.signIn.getUsersOnDisk();
			expect(Array.isArray(users)).toBe(true);
			expect(users.length).toBe(0);
		}, [], 2);
	});

	itAsync(`won't startup with a wrong pass`, async () => {
		
		// start MailerId provisioning
		await execExpects(app.c, async function(userId: string) {
			let userExists = await w3n.signIn.startLoginToRemoteStorage(userId);
			expect(userExists).toBe(true);
		}, [ user.userId ], 1);

		// completing MailerId provisioning
		app.c.timeouts('script', 59000);
		await execExpects(app.c, async function(pass: string) {
			let notifications: number[] = [];
			let notifier = (p) => { notifications.push(p); }
			let ok = await w3n.signIn.completeLoginAndLocalSetup(pass, notifier);
			expect(ok).toBe(false, 'false should be returned for wrong pass');
			checkKeyDerivNotifications(notifications);
		}, [ 'wrong password' ]);
		app.c.timeouts('script', 5000);
	}, 60000);

	itAsync('starts with correct pass', async () => {

		// start login
		await execExpects(app.c, async function(userId: string) {
			let userExists = await w3n.signIn.startLoginToRemoteStorage(userId);
			expect(userExists).toBe(true);
		}, [ user.userId ], 1);

		// complete login and a local storage setup
		app.c.timeouts('script', 59000);
		await execExpects(app.c, async function(pass: string) {
			let notifications: number[] = [];
			let notifier = (p) => { notifications.push(p); }
				let ok = await w3n.signIn.completeLoginAndLocalSetup(pass, notifier);
				expect(ok).toBe(true, 'indicates completion of login and storage setup');
				checkKeyDerivNotifications(notifications);
		}, [ user.pass ]);
		app.c.timeouts('script', 5000);
		await sleep(5000);	// for windows switch over
	}, 60000);

	itAsync('startup objects are not injected into the second window',
		checkSecondWindow(() => app));

});