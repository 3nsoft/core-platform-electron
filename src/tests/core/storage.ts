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

import { itAsync, afterEachAsync, beforeAllAsync }
	from '../libs-for-tests/async-jasmine';
import { setupWithUsers, checkRemoteExpectations }
	from '../libs-for-tests/setups';
import { AppRunner } from '../libs-for-tests/app-runner';
import { fsSpecsForWebDrvCtx } from '../libs-for-tests/spec-module';
import { resolve } from 'path';

declare var w3n: {
	mail: web3n.asmail.Service;
	storage: web3n.storage.Service;
	device: {
		openFileDialog: typeof web3n.device.files.openFileDialog;
		saveFileDialog: typeof web3n.device.files.saveFileDialog;
	};
}
declare var cExpect: typeof expect;
declare var cFail: typeof fail;
declare function collectAllExpectations(): void;

async function makeTestLocalFSIn(client: WebdriverIO.Client<any>,
		varName: string|null = null): Promise<void> {
	await <any> client.executeAsync(async function(varName: string|null, done) {
		if (varName === null) { varName = 'testFS'; }
		(<any> window)[varName] = await w3n.storage.getAppLocalFS(
			'computer.3nweb.test');
		done();
	}, varName);
}

async function makeTestSyncedFSIn(client: WebdriverIO.Client<any>,
		varName: string|null = null): Promise<void> {
	await <any> client.executeAsync(async function(varName: string|null, done) {
		if (varName === null) { varName = 'testFS'; }
		(<any> window)[varName] = await w3n.storage.getAppSyncedFS(
			'computer.3nweb.test');
		done();
	}, varName);
}

async function makeUtilFuncsIn(client: WebdriverIO.Client<any>):
		Promise<void> {
	await <any> client.executeAsync(async function(done) {
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
		done();
	});
}

async function clearTestFS(client: WebdriverIO.Client<any>,
		varName: string|null = null): Promise<void> {
	await client.executeAsync(async function(varName: string|null, done) {
		if (varName === null) { varName = 'testFS'; }
		let testFS: web3n.storage.FS = (window as any)[varName];
		try {
			let items = await testFS.listFolder('');
			let delTasks: Promise<void>[] = [];
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
		} catch (err) {
			console.error(`Error occured in cleaning test fs: \n${JSON.stringify(err, null, '  ')}`);
		}
		done();
	}, varName);
}

describe('3NStorage', () => {

	let s = setupWithUsers();
	let app: AppRunner;

	beforeAllAsync(async () => {
		app = s.apps.get(s.users[0].userId)!;
	});

	afterEachAsync(async () => {
		await s.displayStdOutLogs();
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
			let exps = (await app.c.executeAsync(
			async function(appDomain, done) {
				await w3n.storage.getAppSyncedFS(appDomain)
				.then((fs) => {
					cFail('should not produce FS for an arbitrary app');
				}, (e) => {
					cExpect(e).toBeTruthy();
				});
				done(collectAllExpectations());
			}, 'com.app.unknown')).value;
			checkRemoteExpectations(exps, 1);
		});

		const allowedAppFS = [
			'computer.3nweb.mail',
			'computer.3nweb.contacts',
			'computer.3nweb.test'
		];

		itAsync('produces FS for an app, associated with this window',
				async () => {
			for (let appDomain of allowedAppFS) {
				let exps = (await app.c.executeAsync(
				async function(appDomain, done) {
					let fs = await w3n.storage.getAppSyncedFS(appDomain);
					cExpect(fs).toBeTruthy();
					done(collectAllExpectations());
				}, appDomain)).value;
				checkRemoteExpectations(exps, 1);
			}
		});

		itAsync('concurrently produces FS for an app',
				async () => {
			let appDomain = allowedAppFS[0];
			let exps = (await app.c.executeAsync(
			async function(appDomain, done) {
				let promises: Promise<web3n.storage.FS>[] = [];
				for (let i=0; i<10; i+=1) {
					let promise = w3n.storage.getAppSyncedFS(appDomain);
					promises.push(promise);
				}
				await Promise.all(promises)
				.then((fss) => {
					for (let fs of fss) {
						cExpect(fs).toBeTruthy();
					}
				}, (err) => {
					cFail(`Fail to concurrently get app fs`);
				});
				done(collectAllExpectations());
			}, appDomain)).value;
			checkRemoteExpectations(exps, 10);
		});

	});

	describe('.getAppLocalFS', () => {

		itAsync('will not produce FS for an app, not associated with this window',
				async () => {
			let exps = (await app.c.executeAsync(
			async function(appDomain, done) {
				await w3n.storage.getAppLocalFS(appDomain)
				.then((fs) => {
					cFail('should not produce FS for an arbitrary app');
				}, (e) => {
					cExpect(e).toBeTruthy();
				});
				done(collectAllExpectations());
			}, 'com.app.unknown')).value;
			checkRemoteExpectations(exps, 1);
		});

		const allowedAppFS = [
			'computer.3nweb.mail',
			'computer.3nweb.contacts',
			'computer.3nweb.test'
		];

		itAsync('produces FS for an app, associated with this window',
				async () => {
			for (let appDomain of allowedAppFS) {
				let exps = (await app.c.executeAsync(
				async function(appDomain, done) {
					let fs = await w3n.storage.getAppLocalFS(appDomain);
					cExpect(fs).toBeTruthy();
					done(collectAllExpectations());
				}, appDomain)).value;
				checkRemoteExpectations(exps, 1);
			}
		});

		itAsync('concurrently produces FS for an app',
				async () => {
			let appDomain = allowedAppFS[0];
			let exps = (await app.c.executeAsync(
			async function(appDomain, done) {
				let promises: Promise<web3n.storage.FS>[] = [];
				for (let i=0; i<10; i+=1) {
					let promise = w3n.storage.getAppLocalFS(appDomain);
					promises.push(promise);
				}
				await Promise.all(promises)
				.then((fss) => {
					for (let fs of fss) {
						cExpect(fs).toBeTruthy();
					}
				}, (err) => {
					cFail(`Fail to concurrently get app fs`);
				});
				done(collectAllExpectations());
			}, appDomain)).value;
			checkRemoteExpectations(exps, 10);
		});

	});

	describe('local FS is web3n.files.FS', () => {

		beforeAllAsync(async () => {
			await makeTestLocalFSIn(app.c);
			await makeUtilFuncsIn(app.c);
		});

		afterEachAsync(async () => {
			await clearTestFS(app.c);
		});

		fsSpecsForWebDrvCtx(
			() => app.c,
			resolve(__dirname, '../shared-checks/fs'),
			'storage-fs');

	});

	describe('synced FS is web3n.files.FS', () => {

		beforeAllAsync(async () => {
			await makeTestSyncedFSIn(app.c);
			await makeUtilFuncsIn(app.c);
		});

		afterEachAsync(async () => {
			await clearTestFS(app.c);
		});

		fsSpecsForWebDrvCtx(
			() => app.c,
			resolve(__dirname, '../shared-checks/fs'),
			'storage-fs');

	});

	describe('local FS is web3n.storage.FS', () => {

		beforeAllAsync(async () => {
			await makeTestLocalFSIn(app.c);
			await makeUtilFuncsIn(app.c);
		});

		afterEachAsync(async () => {
			await clearTestFS(app.c);
		});

		fsSpecsForWebDrvCtx(
			() => app.c,
			resolve(__dirname, './storage/fs'));

	});

	describe('synced FS is web3n.storage.FS', () => {

		beforeAllAsync(async () => {
			await makeTestSyncedFSIn(app.c);
			await makeUtilFuncsIn(app.c);
		});

		afterEachAsync(async () => {
			await clearTestFS(app.c);
		});

		fsSpecsForWebDrvCtx(
			() => app.c,
			resolve(__dirname, './storage/fs'));

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

		fsSpecsForWebDrvCtx(
			() => app.c,
			resolve(__dirname, './storage/local-n-synced'));

	});

});
