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

import { itAsync } from './async-jasmine';
import { AppRunner } from './app-runner';

declare var w3n: {
	signUp: Web3N.Startup.SignUpService;
	signIn: Web3N.Startup.SignInService;
}

export function checkSecondWindow(app: () => AppRunner): () => Promise<void> {
	return async () => {
		// ad hoc test of client not being focused on any window
		let flag: string = (await app().c.executeAsync(async function(done) {
			done('still focused');
		})).value;
		expect(flag).toBeFalsy();
		
		// focus on a new window
		await (<any> app().c).windowByIndex(0);

		// check in the new window
		let t: { tIn: string; tUp: string; } = (await app().c.execute(function() {
			return {
				tIn: typeof w3n.signIn,
				tUp: typeof w3n.signUp
			};
		})).value;
		expect(t.tIn).toBe('undefined');
		expect(t.tUp).toBe('undefined');
	}
}

export function checkKeyDerivNotifications(notifPerc: number[]): void {
	expect(notifPerc.length).toBeGreaterThan(0);
	let prevP = -1;
	for (let i=0; i < notifPerc.length; i+=1) {
		let p = notifPerc[i];
		expect(p).toBeGreaterThan(prevP);
		prevP = p;
	}
}

Object.freeze(exports);