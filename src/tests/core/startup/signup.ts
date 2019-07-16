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

import { itAsync, beforeAllAsync } from '../../libs-for-tests/async-jasmine';
import { minimalSetup } from '../../libs-for-tests/setups';
import { setRemoteJasmineInClient, execExpects }
	from '../../libs-for-tests/remote-js-utils';
import { sleep } from '../../../lib-common/processes';
import { checkSecondWindow, setKeyDerivNotifsChecker }
	from '../../libs-for-tests/startup';

declare var w3n: {
	signUp: web3n.startup.SignUpService;
	signIn: web3n.startup.SignInService;
}
declare function checkKeyDerivNotifications(notifPerc: number[]): void;

// NOTE: it-specs inside signUp process expect to run in a given order -- they
//		change app's state, expected by following specs in this describe.
describe('signUp process', () => {

	const s = minimalSetup();

	beforeAllAsync(async () => {
		await setRemoteJasmineInClient(s.app.c);
		await setKeyDerivNotifsChecker(s.app.c);
	});

	const name = 'Mike Marlow ';
	const pass = 'some long passphrase';

	itAsync('gets available addresses', async () => {
		await execExpects(s.c, async function(name: string,
				signupDomains: string[]) {
			const addresses = await w3n.signUp.getAvailableAddresses(name);
			expect(Array.isArray(addresses)).toBe(true);
			expect(addresses.length).toBe(signupDomains.length);
			for (let d of signupDomains) {
				expect(addresses).toContain(`${name}@${d}`);
			}
		}, [ name, s.signupDomains ], 2 + s.signupDomains.length);
	});

	itAsync('creates User parameters', async () => {
		s.c.timeouts('script', 59000);
		await execExpects(s.c, async function(pass: string) {
			const notifications: number[] = [];
			const notifier = (p) => { notifications.push(p); }
			await w3n.signUp.createUserParams(pass, notifier);
			checkKeyDerivNotifications(notifications);
		}, [ pass ]);
		s.c.timeouts('script', 5000);
	}, 60000);

	itAsync('creates user account', async () => {
		const userId = `${name}@${s.signupDomains[0]}`;
		await execExpects(s.c, async function(userId: string) {
			const isCreated = await w3n.signUp.addUser(userId);
			expect(isCreated).toBe(true);
		}, [ userId ], 1);
		await sleep(5000);
	}, 10000);

	itAsync('startup objects are not injected into the second window',
		checkSecondWindow(() => s.app));

});