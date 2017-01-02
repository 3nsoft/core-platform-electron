/*
 Copyright (C) 2015 - 2016 3NSoft Inc.

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

import { Duplex } from '../lib-common/ipc/electron-ipc';
import { signUp } from './common';

let names = signUp.reqNames;

export function makeSignUpOnUISide(core: Duplex): web3n.startup.SignUpService {
	let s = {
		
		getAvailableAddresses(name: string): Promise<string[]> {
			return core.makeRequest<string[]>(
				names.getAddressesForName, name);
		},
		
		async addUser(userId: string): Promise<boolean> {
			let isSet = await core.makeRequest<boolean>(names.addUser, userId);
			// when setup is done, duplex can be closed
			if (isSet) {
				core.close();
				core = (undefined as any);
			}
			return isSet;
		},
		
		isActivated(userId: string): Promise<boolean> {
			return core.makeRequest<boolean>(names.isUserActive, userId);
		},
		
		createUserParams(pass: string,
				progressCB: (progress: number) => void): Promise<void> {
			return core.makeRequest<void>(names.createUserParams,
				pass, progressCB);
		},
		
	};
	Object.freeze(s);
	return s;
}

Object.freeze(exports);