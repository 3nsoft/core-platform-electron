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

import { itAsync } from '../../libs-for-tests/async-jasmine';
import { minimalSetup } from '../../libs-for-tests/setups';

declare var w3n: {
	signUp: web3n.startup.SignUpService;
	signIn: web3n.startup.SignInService;
}

describe('3NWeb app initial window', () => {

	let s = minimalSetup();

	itAsync('has injected object for signin(up)', async () => {
		let w3nMembers: string[] = (await s.c.execute(function() {
			return Object.keys(w3n);
		})).value;
		expect(w3nMembers.length).toBe(2);
		expect(w3nMembers).toContain('signIn');
		expect(w3nMembers).toContain('signUp');
	});

});