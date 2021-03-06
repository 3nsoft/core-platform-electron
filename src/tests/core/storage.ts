/*
 Copyright (C) 2016, 2018 3NSoft Inc.
 
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

import { itAsync, afterEachAsync, beforeAllAsync }
	from '../libs-for-tests/async-jasmine';
import { setupWithUsers, execExpects, exec }
	from '../libs-for-tests/setups';
import { AppRunner } from '../libs-for-tests/app-runner';
import { loadSpecsForWebDrvCtx } from '../libs-for-tests/spec-module';
import { resolve } from 'path';
import { SpectronClient } from 'spectron';

declare var w3n: {
	mail: web3n.asmail.Service;
	storage: web3n.storage.Service;
	device: {
		openFileDialog: web3n.device.files.OpenFileDialog;
		saveFileDialog: web3n.device.files.SaveFileDialog;
	};
}

async function makeTestLocalFSIn(client: SpectronClient,
		varName: string|null = null): Promise<void> {
	await exec(client, async function(varName: string|null) {
		if (varName === null) { varName = 'testFS'; }
		(<any> window)[varName] = await w3n.storage.getAppLocalFS(
			'computer.3nweb.test');
	}, varName);
}

async function makeTestSyncedFSIn(client: SpectronClient,
		varName: string|null = null): Promise<void> {
	await exec(client, async function(varName: string|null) {
		if (varName === null) { varName = 'testFS'; }
		(<any> window)[varName] = await w3n.storage.getAppSyncedFS(
			'computer.3nweb.test');
	}, varName);
}

async function makeUtilFuncsIn(client: SpectronClient): Promise<void> {
	await client.execute(function() {
		(<any> window).testRandomBytes = (n: number): Uint8Array => {
			let arr = new Uint8Array(n);
			window.crypto.getRandomValues(arr);
			return arr;
		}
		// copy library's code into client's context
		(<any> window).bytesEqual = function(
				a: Uint8Array, b: Uint8Array): boolean {
			if (a.BYTES_PER_ELEMENT !== b.BYTES_PER_ELEMENT) {
				return false;
			}
			if (a.length !== b.length) { return false; }
			for (let i=0; i<a.length; i+=1) {
				if (a[i] !== b[i]) { return false; }
			}
			return true;
		};
		// copy library's code into client's context
		function deepEqual(a: any, b: any): boolean {
			let t = typeof a;
			if (t !== typeof b) { return false; }
			if (t !== 'object') {
				return (a === b);
			}
			if (a === b) { return true; }
			if ((a === null) || (b === null)) { return false; }
			if (Array.isArray(a)) {
				if (!Array.isArray(b)) { return false; }
				let aArr = <Array<any>> a;
				let bArr = <Array<any>> b;
				if (aArr.length !== bArr.length) { return false; }
				for (let i=0; i<aArr.length; i+=1) {
					if (!deepEqual(aArr[i], bArr[i])) { return false; }
				}
			} else {
				let keys = Object.keys(a);
				if (keys.length !== Object.keys(b).length) { return false; }
				for (let i=0; i<keys.length; i+=1) {
					let key = keys[i];
					if (!deepEqual(a[key], b[key])) { return false; }
				}
			}
			return true;
		};
		(<any> window).deepEqual = deepEqual;
	});
}

async function clearTestFS(client: SpectronClient, varName = 'testFS'):	
		Promise<void> {
	await exec(client, async function(varName: string) {
		const testFS: web3n.files.WritableFS = (window as any)[varName];
		const items = await testFS.listFolder('');
		const delTasks: Promise<void>[] = [];
		for (let f of items) {
			if (f.isFile) {
				delTasks.push(testFS.deleteFile(f.name));
			} else if (f.isFolder) {
				delTasks.push(testFS.deleteFolder(f.name, true));
			} else if (f.isLink) {
				delTasks.push(testFS.deleteLink(f.name));
			} else {
				throw new Error(`File system item is neither file, nor folder`);
			}
		}
		await Promise.all(delTasks);
	}, varName);
}

describe('3NStorage', () => {

	let s = setupWithUsers();
	let app: AppRunner;

	beforeAllAsync(async () => {
		app = s.apps.get(s.users[0].userId)!;
	});

	itAsync('api object is injected', async () => {
		let t: string[] = (await app.c.execute(function() {
			return typeof w3n.storage;
		})).value;
		expect(t).toBe('object');
	});

	describe('.getAppSyncedFS', () => {

		itAsync('will not produce FS for an app, not associated with this window',
				async () => {
			await execExpects(app.c, async function(appDomain: string) {
				await w3n.storage.getAppSyncedFS(appDomain)
				.then(() => {
					fail('should not produce FS for an arbitrary app');
				}, (e) => {
					expect(e).toBeTruthy();
				});
			}, [ 'com.app.unknown' ], 1);
		});

		const allowedAppFS = [
			'computer.3nweb.mail',
			'computer.3nweb.contacts',
			'computer.3nweb.test'
		];

		itAsync('produces FS for an app, associated with this window',
				async () => {
			for (let appDomain of allowedAppFS) {
				await execExpects(app.c, async function(appDomain: string) {
					let fs = await w3n.storage.getAppSyncedFS(appDomain);
					expect(fs).toBeTruthy();
				}, [ appDomain ], 1);
			}
		});

		itAsync('concurrently produces FS for an app',
				async () => {
			let appDomain = allowedAppFS[0];
			await execExpects(app.c, async function(appDomain: string) {
				let promises: Promise<web3n.files.FS>[] = [];
				for (let i=0; i<10; i+=1) {
					let promise = w3n.storage.getAppSyncedFS(appDomain);
					promises.push(promise);
				}
				await Promise.all(promises)
				.then((fss) => {
					for (let fs of fss) {
						expect(fs).toBeTruthy();
					}
				}, () => {
					fail(`Fail to concurrently get app fs`);
				});
			}, [ appDomain ], 10);
		});

	});

	describe('.getAppLocalFS', () => {

		itAsync('will not produce FS for an app, not associated with this window',
				async () => {
			await execExpects(app.c, async function(appDomain: string) {
				await w3n.storage.getAppLocalFS(appDomain)
				.then(() => {
					fail('should not produce FS for an arbitrary app');
				}, (e) => {
					expect(e).toBeTruthy();
				});
			}, [ 'com.app.unknown' ], 1);
		});

		const allowedAppFS = [
			'computer.3nweb.mail',
			'computer.3nweb.contacts',
			'computer.3nweb.test'
		];

		itAsync('produces FS for an app, associated with this window',
				async () => {
			for (let appDomain of allowedAppFS) {
				await execExpects(app.c, async function(appDomain: string) {
					let fs = await w3n.storage.getAppLocalFS(appDomain);
					expect(fs).toBeTruthy();
				}, [ appDomain ], 1);
			}
		});

		itAsync('concurrently produces FS for an app',
				async () => {
			let appDomain = allowedAppFS[0];
			await execExpects(app.c, async function(appDomain: string) {
				let promises: Promise<web3n.files.FS>[] = [];
				for (let i=0; i<10; i+=1) {
					let promise = w3n.storage.getAppLocalFS(appDomain);
					promises.push(promise);
				}
				await Promise.all(promises)
				.then((fss) => {
					for (let fs of fss) {
						expect(fs).toBeTruthy();
					}
				}, () => {
					fail(`Fail to concurrently get app fs`);
				});
			}, [ appDomain ], 10);
		});

	});

	describe('local FS is a web3n.files.WritableFS', () => {

		beforeAllAsync(async () => {
			await makeTestLocalFSIn(app.c);
			await makeUtilFuncsIn(app.c);
		});

		afterEachAsync(async () => {
			await clearTestFS(app.c);
		});

		loadSpecsForWebDrvCtx(
			() => app.c,
			resolve(__dirname, '../fs-checks/not-versioned'),
			'xsp-backed');

	});

	describe('local FS is a web3n.files.WritableFS with versioned API', () => {

		beforeAllAsync(async () => {
			await makeTestLocalFSIn(app.c);
			await makeUtilFuncsIn(app.c);
		});

		afterEachAsync(async () => {
			await clearTestFS(app.c);
		});

		loadSpecsForWebDrvCtx(
			() => app.c,
			resolve(__dirname, '../fs-checks/versioned'));

	});

	describe('synced FS is a web3n.files.WritableFS', () => {

		beforeAllAsync(async () => {
			await makeTestSyncedFSIn(app.c);
			await makeUtilFuncsIn(app.c);
		});

		afterEachAsync(async () => {
			await clearTestFS(app.c);
		});

		loadSpecsForWebDrvCtx(
			() => app.c,
			resolve(__dirname, '../fs-checks/not-versioned'),
			'xsp-backed');

	});

	describe('synced FS is a web3n.files.WritableFS with versioned API', () => {

		beforeAllAsync(async () => {
			await makeTestSyncedFSIn(app.c);
			await makeUtilFuncsIn(app.c);
		});

		afterEachAsync(async () => {
			await clearTestFS(app.c);
		});

		loadSpecsForWebDrvCtx(
			() => app.c,
			resolve(__dirname, '../fs-checks/versioned'));

	});

	describe('local to synced FS linking', () => {

		let varWithSyncedFS = 'syncedTestFS';
		let varWithLocalFS = 'localTestFS'

		beforeAllAsync(async () => {
			await makeTestSyncedFSIn(app.c, varWithSyncedFS);
			await makeTestLocalFSIn(app.c, varWithLocalFS);
			await makeUtilFuncsIn(app.c);
		});

		afterEachAsync(async () => {
			await clearTestFS(app.c, varWithSyncedFS);
			await clearTestFS(app.c, varWithLocalFS);
		});

		loadSpecsForWebDrvCtx(
			() => app.c,
			resolve(__dirname, '../fs-checks/local-to-synced-linking'));

	});

});
