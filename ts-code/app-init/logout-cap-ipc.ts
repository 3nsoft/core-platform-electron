/*
 Copyright (C) 2021 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { ExposedFn, Caller } from 'core-3nweb-client-lib';
import { ProtoType } from '../ipc-via-protobuf/protobuf-msg';

type Logout = web3n.ui.Logout;

function appsOpenerType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('logout.proto', `logout.${type}`);
}


export namespace logout {

	interface Request {
		closePlatform: boolean;
	}

	const requestType = appsOpenerType<Request>('LogoutRequestBody');

	export function expose(fn: Logout): ExposedFn {
		return buf => {
			const { closePlatform } = requestType.unpack(buf);
			const promise = fn(closePlatform);
			return { promise };
		}
	}

	export function makeClient(caller: Caller, objPath: string[]): Logout {
		return async closePlatform => {
			const req = requestType.pack({ closePlatform });
			await caller.startPromiseCall(objPath, req);
		};
	}

}
Object.freeze(logout);


export const exposeLogoutCAP = logout.expose;

export const makeLogoutCaller = logout.makeClient;


Object.freeze(exports);