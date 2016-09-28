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

import { commToMain } from '../lib-common/ipc/electron-ipc';
import { makeSignUpOnUISide } from './signup';
import { makeSignInOnUISide } from './signin';
import { channels } from './common';

/**
 * @return a 3NWeb api object for a startup app.
 */
export function make3NWebObject() {
	let exposeServices = {
		signUp: makeSignUpOnUISide(commToMain(channels.signup)),
		signIn: makeSignInOnUISide(commToMain(channels.signin)),
	};
	Object.freeze(exposeServices);
	return exposeServices;
}

Object.freeze(exports);