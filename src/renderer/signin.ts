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
import { signIn } from './common';

let names = signIn.reqNames;

export function makeSignInOnUISide(core: Duplex): Web3N.Startup.SignInService {
	let s = {
		
		getUsersOnDisk(): Promise<string[]> {
			return core.makeRequest<string[]>(names.getUsersOnDisk, null);
		},
		
		startMidProvisioning(address: string): Promise<boolean> {
			return core.makeRequest<boolean>(names.startMidProv, address);
		},
		
		completeMidProvisioning(pass: string,
				progressCB: (progress: number) => void): Promise<boolean> {
			return core.makeRequest<boolean>(names.completeMidProv,
				pass, progressCB);
		},
		
		async setupStorage(address: string, pass: string,
				progressCB: (progress: number) => void): Promise<boolean> {
			let req: signIn.SetupStoreRequest = {
				user: address,
				pass: pass
			};
			let isSet = await core.makeRequest<boolean>(names.setupStorage,
				req, progressCB);
			// when setup is done, duplex can be closed
			if (isSet) {
				core.close();
				core = null;
			}
			return isSet;
		},
		
	};
	Object.freeze(s);
	return s;
}

Object.freeze(exports);