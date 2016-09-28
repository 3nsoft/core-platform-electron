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

import { ASMailMock, ASMailMockConfig } from './asmail';
import { StorageMock, StorageMockConfig } from './storage';
import { openFileDialog, saveFileDialog } from './device';

/**
 * @return a 3NWeb api mock object for a client app.
 */
export function make3NWebObject(userInd: number, mailConf: ASMailMockConfig,
		storeConf: StorageMockConfig) {
	let userConf = mailConf.existingUsers[userInd];
	if (!userConf) { throw new Error(`User index ${userInd} is not pointing to user id in array of ${mailConf.existingUsers.length} existing users.`) }
	let userId = userConf.address;
	let mail = new ASMailMock();
	let storage = new StorageMock();
	let exposeServices = {
		mail: mail.wrap(),
		storage: storage.wrap(),
		device: {
			openFileDialog,
			saveFileDialog
		},
		isMock: true
	};
	Object.freeze(exposeServices);
	mail.initFor(userId, mailConf)
	.then(() => {
		return storage.initFor(userId, storeConf);
	})
	.catch((err) => {
		console.error(err);
		while (err.cause) {
			console.error('Caused by:');
			err = err.cause;
			console.error(err);
		}
	});
	return exposeServices;
}

Object.freeze(exports);