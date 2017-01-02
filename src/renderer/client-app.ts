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
import { makeASMailOnUISide } from './asmail';
import { makeStorageOnUISide } from './storage';
import { channels } from './common';
import { makeDeviceOnUISide } from './device';

/**
 * @return a 3NWeb api object for a client app.
 */
export function make3NWebObject() {
	let { storage, proxies } = makeStorageOnUISide(
		commToMain(channels.storage));
	let mail = makeASMailOnUISide(
		commToMain(channels.asmail), proxies);
	let device = makeDeviceOnUISide(
		commToMain(channels.device), proxies);
	let exposeServices = {
		mail,
		storage,
		device
	};
	Object.freeze(exposeServices);
	return exposeServices;
}

Object.freeze(exports);