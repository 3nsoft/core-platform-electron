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

import { itAsync, fitAsync, xitAsync, afterEachAsync, beforeAllAsync }
	from '../libs-for-tests/async-jasmine';
import { setupWithUsers, setAwaiterJS6InClient, setRemoteJasmineInClient,
	checkRemoteExpectations } from '../libs-for-tests/setups';
import { AppRunner } from '../libs-for-tests/app-runner';
import { fsSpecsForWebDrvCtx } from '../shared-checks/fs/specs';

declare var w3n: {
	mail: Web3N.ASMail.Service;
	storage: Web3N.Storage.Service;
	device: {
		openFileDialog: typeof Web3N.Device.Files.openFileDialog;
		saveFileDialog: typeof Web3N.Device.Files.saveFileDialog;
	};
}
declare var cExpect: typeof expect;
declare var cFail: typeof fail;
declare function collectAllExpectations(): void;

describe('3NStorage', () => {

	let s = setupWithUsers();
	let app: AppRunner;

	beforeAllAsync(async () => {
		app = s.apps.get(s.users[0].userId);
		await setAwaiterJS6InClient(app);
		await setRemoteJasmineInClient(app);
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

	describe('.getAppFS', () => {

		itAsync('will not produce FS for an app, not associated with this window',
				async () => {
			let exps = (await app.c.executeAsync(
			async function(appDomain, done) {
				await w3n.storage.getAppFS(appDomain)
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
					let fs = await w3n.storage.getAppFS(appDomain);
					cExpect(fs).toBeTruthy();
					done(collectAllExpectations());
				}, appDomain)).value;
				checkRemoteExpectations(exps, 1);
			}
		});

	});

	async function makeTestFSInClient(): Promise<void> {
		await <any> app.c.executeAsync(async function(done) {
			(<any> window).testFS = await w3n.storage.getAppFS(
				'computer.3nweb.test');
			done();
		});
	}

	describe('FS is Web3N.Files.FS',
		fsSpecsForWebDrvCtx(() => app.c, makeTestFSInClient, 'storage-fs'));

	xitAsync('downloads all existing objects, when local cache is empty',
	async () => {
		
		// XXX 1) create non-trivial file tree,
		//		2) sleep a little, to let sync processes complete
		//		3) stop client
		//		4) remove test data folder
		//		5) start client for the same user
		//		6) read all of file tree elements, comparing with expectations

	});

});