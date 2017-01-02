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

import { SpecDescribe, SpecIt } from '../../libs-for-tests/spec-module';

type FileException = web3n.files.FileException;
declare var testFS: web3n.files.FS;
let cExpect = expect;
let cFail = fail;
function collectAllExpectations(): void {};

export let specs: SpecDescribe = {
	description: '.readonlySubRoot',
	its: []
};

let it: SpecIt = { expectation: 'creates sub-root based on existing folder' };
it.func = async function(done: Function) {
	try {
		let path = 'sub-root';
		await testFS.makeFolder(path);
		cExpect(await testFS.checkFolderPresence(path)).toBe(true);
		let subRoot = await testFS.readonlySubRoot(path);
		cExpect(subRoot).toBeTruthy();
		cExpect(subRoot.writable).toBe(false);
		cExpect(subRoot.versioned).toBe(testFS.versioned);
		cExpect(Array.isArray(await subRoot.listFolder(''))).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 5;
specs.its.push(it);

it = { expectation: 'fails to create a sub-root, whenfolder is missing' };
it.func = async function(done: Function) {
	try {
		let path = 'sub-root2';
		cExpect(await testFS.checkFolderPresence(path)).toBe(false);
		await testFS.readonlySubRoot(path).then(() => {
			cFail('making a readonly sub-root on a missing folder should fail')
		}, (exc: FileException) => {
			cExpect(exc.notFound).toBe(true);
			if (!exc.notFound) { throw exc; }
		})
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 2;
specs.its.push(it);

Object.freeze(exports);