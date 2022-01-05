/*
 Copyright (C) 2018 - 2020 3NSoft Inc.
 
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

import { loadSpecs } from '../libs-for-tests/spec-module';
import { clearFSInApp } from '../libs-for-tests/fs-utils';

declare var w3n: {
	storage: web3n.storage.Service;
}

const userFSVarName = 'mntFS';

describe(`FSMount of user data`, () => {

	beforeAll(async () => {
		(window as any)[userFSVarName] =
				(await w3n.storage.getUserFS!('synced')).item;
	});

	afterEach(async () => {
		await clearFSInApp(userFSVarName);
	});

	loadSpecs(
		resolve(__dirname, '../fs-mount-checks/mount-of-xsp-fs'));

});