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

type SignUpService = web3n.startup.SignUpService;

export function wrapRemoteSignUp(rem: SignUpService): SignUpService {
	const signUp: SignUpService = {
		addUser: wrapRemoteFunc(rem.addUser),
		createUserParams: wrapRemoteFunc(
			rem.createUserParams,
			[ null, wrapLocalListener ]),
		getAvailableAddresses: wrapRemoteFunc(rem.getAvailableAddresses),
		isActivated: wrapRemoteFunc(rem.isActivated)
	};
	return Object.freeze(signUp);
}

