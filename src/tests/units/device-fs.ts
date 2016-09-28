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

import { itAsync, beforeEachAsync, afterEachAsync, beforeAllAsync,
	afterAllAsync, fitAsync, xitAsync }
	from '../libs-for-tests/async-jasmine';
import { DeviceFS } from '../../lib-client/local-files/device-fs';
import * as nodeFS from '../../lib-common/async-fs-node';
import { resolve } from 'path';
import { bytes as randomBytes } from '../../lib-client/random-node';
import { fsSpecsForCurrentCtx } from '../shared-checks/fs/specs';

type FileException = Web3N.Files.FileException;

const TEST_DATA = resolve(__dirname, '../../../test-data');

describe('DeviceFS', () => {

	let rootPath = resolve(TEST_DATA, 'root');

	beforeAllAsync(async () => {
		await nodeFS.rmDirWithContent(TEST_DATA)
		.catch((e: FileException) => { if (!e.notFound) { throw e; } });
		await nodeFS.mkdir(TEST_DATA);
		await nodeFS.mkdir(rootPath);
	});

	afterAllAsync(async () => {
		await nodeFS.rmDirWithContent(TEST_DATA);
	});

	itAsync('is created with static make function', async () => {

		// creating on non-existing folder should fail
		DeviceFS.make(resolve(TEST_DATA, 'not-existing-folder'))
		.then(() => {
			fail('device fs should not be created in non-existing folder');
		}, (e: FileException) => {
			expect(e.notFound).toBeTruthy();
		});

		let rootPath = resolve(TEST_DATA, 'root-for-creation');
		await nodeFS.mkdir(rootPath);

		let devFS = await DeviceFS.make(rootPath);
		expect(devFS).toBeTruthy();

		nodeFS.rmdir(rootPath);

	});

	describe('is Web3N.Files.FS',
		fsSpecsForCurrentCtx(() => DeviceFS.make(rootPath)));

});