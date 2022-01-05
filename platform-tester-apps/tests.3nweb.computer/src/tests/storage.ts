/*
 Copyright (C) 2016, 2018, 2020 - 2021 3NSoft Inc.
 
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

import { itCond, afterEachCond } from './libs-for-tests/jasmine-utils.js';
import { loadSpecs } from './libs-for-tests/spec-module.js';
import { clearFS, SetupWithTestFS, SetupWithTwoFSs } from './fs-checks/test-utils.js';
import { specs as specsNotVersioned } from './fs-checks/not-versioned/index.js';
import { specs as specsVersioned } from './fs-checks/versioned/index.js';
import { specs as specsLocToSyncLinking } from './fs-checks/local-to-synced-linking/index.js';
import { specs as specsFileSink } from './file-sink-checks/index.js';

type StorageException = web3n.storage.StorageException;

const allowedAppFS = [
	"tests.3nweb.computer",
	"sub-app-1.tests.3nweb.computer",
	"sub-app-2.tests.3nweb.computer"
].map(d => d.split('.').reverse().join('.'));

describe('3NStorage', () => {

	itCond('storage capability is present in test app', async () => {
		expect(typeof w3n.storage).toBe('object');
	});

	describe('.getAppSyncedFS', () => {

		itCond('will not produce FS for domain, not associated with app',
				async () => {
			await w3n.storage!.getAppSyncedFS('unknown.app.com')
			.then(() => {
				fail('should not produce FS for an arbitrary app');
			}, (e: StorageException) => {
				expect(e.runtimeException).toBe(true);
				expect(e.type).toBe('storage');
				expect(e.notAllowedToOpenFS).toBeTruthy();
			});
		});

		itCond('produces FS for domains (reversed), associated with app',
				async () => {
			for (const appDomain of allowedAppFS) {
				const fs = await w3n.storage!.getAppSyncedFS(appDomain);
				expect(fs).toBeTruthy();
			}
		});

		itCond('concurrently produces FS for an app', async () => {
			const promises: Promise<web3n.files.FS>[] = [];
			for (let i=0; i<10; i+=1) {
				const promise = w3n.storage!.getAppSyncedFS();
				promises.push(promise);
			}
			await Promise.all(promises)
			.then((fss) => {
				for (const fs of fss) {
					expect(fs).toBeTruthy();
				}
			}, () => {
				fail(`Fail to concurrently get app fs`);
			});
		});

	});

	describe('.getAppLocalFS', () => {

		itCond('will not produce FS for domain, not associated with app',
				async () => {
			await w3n.storage!.getAppLocalFS('com.app.unknown')
			.then(() => {
				fail('should not produce FS for an arbitrary app');
			}, (e: StorageException) => {
				expect(e.runtimeException).toBe(true);
				expect(e.type).toBe('storage');
				expect(e.notAllowedToOpenFS).toBeTruthy();
			});
		});

		itCond('produces FS for domains (reversed), associated with app',
				async () => {
			for (const appDomain of allowedAppFS) {
				const fs = await w3n.storage!.getAppLocalFS(appDomain);
				expect(fs).toBeTruthy();
			}
		});

		itCond('concurrently produces FS for an app', async () => {
			const appDomain = allowedAppFS[0];
			const promises: Promise<web3n.files.FS>[] = [];
			for (let i=0; i<10; i+=1) {
				const promise = w3n.storage!.getAppLocalFS(appDomain);
				promises.push(promise);
			}
			await Promise.all(promises)
			.then((fss) => {
				for (const fs of fss) {
					expect(fs).toBeTruthy();
				}
			}, () => {
				fail(`Fail to concurrently get app fs`);
			});
		});

	});

	describe('.getSysFS', () => {

		itCond('produces collection of items in synced storage', async () => {
			const sysItems = await w3n.storage!.getSysFS!('synced');
			expect(sysItems.isCollection).toBe(true);
		});

	});

	describe('local FS is a web3n.files.WritableFS', () => {

		const fsSetup = {} as SetupWithTestFS;

		beforeAll(async () => {
			fsSetup.testFS = await w3n.storage!.getAppLocalFS();
			fsSetup.isUp = true;
		});

		afterEachCond(async () => {
			await clearFS(fsSetup.testFS);
		});

		loadSpecs(
			fsSetup,
			specsNotVersioned);

		loadSpecs(
			fsSetup,
			specsFileSink);

	});

	describe('local FS is a web3n.files.WritableFS with versioned API', () => {

		const fsSetup = {} as SetupWithTestFS;

		beforeAll(async () => {
			fsSetup.testFS = await w3n.storage!.getAppLocalFS();
			fsSetup.isUp = true;
		});

		afterEachCond(async () => {
			await clearFS(fsSetup.testFS);
		});

		loadSpecs(
			fsSetup,
			specsVersioned);

	});

	describe('synced FS is a web3n.files.WritableFS', () => {

		const fsSetup = {} as SetupWithTestFS;

		beforeAll(async () => {
			fsSetup.testFS = await w3n.storage!.getAppSyncedFS();
			fsSetup.isUp = true;
		});

		afterEachCond(async () => {
			await clearFS(fsSetup.testFS);
		});

		loadSpecs(
			fsSetup,
			specsNotVersioned);

		loadSpecs(
			fsSetup,
			specsFileSink);

	});

	describe('synced FS is a web3n.files.WritableFS with versioned API', () => {

		const fsSetup = {} as SetupWithTestFS;

		beforeAll(async () => {
			fsSetup.testFS = await w3n.storage!.getAppSyncedFS();
			fsSetup.isUp = true;
		});

		afterEachCond(async () => {
			await clearFS(fsSetup.testFS);
		});

		loadSpecs(
			fsSetup,
			specsVersioned);

	});

	describe('local to synced FS linking', () => {

		const fsSetup = {} as SetupWithTwoFSs;

		beforeAll(async () => {
			fsSetup.localTestFS = await w3n.storage!.getAppLocalFS();
			fsSetup.syncedTestFS = await w3n.storage!.getAppSyncedFS();
			fsSetup.isUp = true;
		});

		afterEachCond(async () => {
			await clearFS(fsSetup.localTestFS);
			await clearFS(fsSetup.syncedTestFS);
		});

		loadSpecs(
			fsSetup,
			specsLocToSyncLinking);

	});

});
