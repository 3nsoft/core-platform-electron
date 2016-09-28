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

import { itAsync, afterEachAsync, beforeAllAsync, xitAsync }
	from '../../libs-for-tests/async-jasmine';
import { checkRemoteExpectations } from '../../libs-for-tests/setups';
import { resolve } from 'path';
import { readdirSync } from 'fs';

declare var testFS: Web3N.Files.FS;

export interface SpecIt {
	expectation: string;
	disableIn?: string;
	func?: Function;
	funcArgs?: any[];
	numOfExpects?: number;
}

export interface SpecDescribe {
	description: string;
	its: SpecIt[];
}

let specs: SpecDescribe[] = [];

const SPECS_FOLDER = resolve(__dirname, './specs-for-methods');
let modulesWithSpecs = readdirSync(SPECS_FOLDER);
for (let fName of modulesWithSpecs) {
	let s: SpecDescribe = require(resolve(SPECS_FOLDER, fName)).specs;
	if (s) {
		specs.push(s);
	} else {
		console.error(`Module ${fName} is not exposing specs objects with tests`);
	}
}

export function fsSpecsForWebDrvCtx(c: () => WebdriverIO.Client<any>,
		makeTestFSInClient: () => Promise<void>,
		disableFlag?: string): () => void {
	return () => {

		beforeAllAsync(async function() {
			await makeTestFSInClient();
			// inject testRandomBytes(), bytesEqual()
			await <any> c().executeAsync(async function(done) {
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
			
		});

		afterEachAsync(async function() {
			await c().executeAsync(async function(done) {
				let items = await testFS.listFolder('');
				let delTasks: Promise<void>[] = [];
				for (let f of items) {
					if (f.isFile) {
						delTasks.push(testFS.deleteFile(f.name));
					} else if (f.isFolder) {
						delTasks.push(testFS.deleteFolder(f.name, true));
					} else {
						throw new Error(`File system item is neither file, nor folder`);
					}
				}
				await Promise.all(delTasks);
				done();
			});
		});

		specs.forEach((d) => {
			describe(d.description, () => {
				d.its.forEach((it) => {
					let spec = ((!it.func || (disableFlag && it.disableIn &&
						it.disableIn.match(disableFlag))) ? xitAsync : itAsync);
					spec(it.expectation, async function() {
						let exec = (it.funcArgs ?
							c().executeAsync(it.func, ...it.funcArgs):
							c().executeAsync(it.func));
						let exps = (await exec).value;
						checkRemoteExpectations(exps, it.numOfExpects);
					});
				});
			});
		});
		
	};
}

export function fsSpecsForCurrentCtx(
		makeTestFS: () => Promise<Web3N.Files.FS>,
		disableFlag?: string): () => void {
	return () => {

		beforeAllAsync(async function() {
			(<any> global).testFS = await makeTestFS();
		});

		afterEachAsync(async function() {
			let items = await testFS.listFolder('');
			let delTasks: Promise<void>[] = [];
			for (let f of items) {
				if (f.isFile) {
					delTasks.push(testFS.deleteFile(f.name));
				} else if (f.isFolder) {
					delTasks.push(testFS.deleteFolder(f.name, true));
				} else {
					throw new Error(`File system item is neither file, nor folder`);
				}
			}
			await Promise.all(delTasks);
		});

		specs.forEach((d) => {
			describe(d.description, () => {
				d.its.forEach((it) => {
					let spec = ((!it.func || (disableFlag && it.disableIn &&
						it.disableIn.match(disableFlag))) ? xitAsync : itAsync);
					spec(it.expectation, async function() {
						let done = () => {};
						if (it.funcArgs) {
							await it.func(...it.funcArgs, done);
						} else {
							await it.func(done);
						}
					});
				});
			});
		});

	};
}

Object.freeze(exports);