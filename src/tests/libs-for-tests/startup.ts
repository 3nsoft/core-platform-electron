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

import { AppRunner } from './app-runner';
import { SpectronClient } from 'spectron';

declare var w3n: {
	signUp: web3n.startup.SignUpService;
	signIn: web3n.startup.SignInService;
}

export function checkSecondWindow(app: () => AppRunner): () => Promise<void> {
	return async () => {
		// ad hoc test of client not being focused on any window
		let flag: string = (await app().c.execute(function() {
			return 'still focused';
		})).value;
		expect(flag).toBeFalsy();
		
		// focus on a new window
		await app().c.windowByIndex(0);

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

export async function setKeyDerivNotifsChecker(c: SpectronClient):
		Promise<void> {
	await c.execute(async function() {
		(window as any).checkKeyDerivNotifications = (notifPerc: number[]) => {
			expect(notifPerc.length).toBeGreaterThan(0);
			let prevP = -1;
			for (let i=0; i < notifPerc.length; i+=1) {
				let p = notifPerc[i];
				expect(p).toBeGreaterThan(prevP);
				prevP = p;
			}
		}
	});
}

Object.freeze(exports);