/*
 Copyright (C) 2017 3NSoft Inc.

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

import { wrapLocalListener, wrapRemoteFunc } from '../wrapping';

type SignInService = web3n.startup.SignInService;

export function wrapRemoteSignIn(rem: SignInService): SignInService {
	const signIn: SignInService = {
		completeLoginAndLocalSetup: wrapRemoteFunc(
			rem.completeLoginAndLocalSetup,
			[ null, wrapLocalListener ]),
		getUsersOnDisk: wrapRemoteFunc(rem.getUsersOnDisk),
		startLoginToRemoteStorage: wrapRemoteFunc(rem.startLoginToRemoteStorage),
		useExistingStorage: wrapRemoteFunc(
			rem.useExistingStorage,
			[ null, null, wrapLocalListener ])
	};
	return Object.freeze(signIn);
}

