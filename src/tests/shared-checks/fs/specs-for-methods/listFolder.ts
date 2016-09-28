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

import { SpecDescribe, SpecIt } from '../specs';
import { deepEqual as jsonDeepEqual } from '../../../libs-for-tests/json-equal';

type FileException = Web3N.Files.FileException;
declare var testFS: Web3N.Files.FS;
let deepEqual = jsonDeepEqual;
let cExpect = expect;
let cFail = fail;
function collectAllExpectations(): void {};

export let specs: SpecDescribe = {
	description: '.listFolder',
	its: []
};

let it: SpecIt = { expectation: 'lists root' };
it.func = async function(done: Function) {
	try {
		let lst = await testFS.listFolder('');
		cExpect(Array.isArray(lst)).toBe(true);
		cExpect(lst.length).toBe(0);

		await testFS.makeFolder('folder1');
		await testFS.writeTxtFile('file1', '');
		await testFS.writeTxtFile('folder1/file2', '');

		lst = await testFS.listFolder('');
		cExpect(lst.length).toBe(2);
		for (let entry of lst) {
			if (entry.isFile) {
				cExpect(entry.name).toBe('file1');
			} else if (entry.isFolder) {
				cExpect(entry.name).toBe('folder1');
			} else {
				cFail(`folder listing has unknown type: ${JSON.stringify(entry, null, '  ')}`);
			}
		}

		let lst2 = await testFS.listFolder('.');
		cExpect(deepEqual(lst2, lst)).toBe(true);
		
		lst2 = await testFS.listFolder('/');
		cExpect(deepEqual(lst2, lst)).toBe(true);
		
		lst2 = await testFS.listFolder('../../');
		cExpect(deepEqual(lst2, lst)).toBe(true);

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 8;
specs.its.push(it);

it = { expectation: 'fails to list non-existing folder' };
it.func = async function(done: Function) {
	try {
		let fName = 'non-existing-folder';
		cExpect(await testFS.checkFolderPresence(fName)).toBe(false);
		await testFS.listFolder(fName)
		.then(() => {
			cFail('listing should fail for non-existing folder')
		}, (exc: FileException) => {
			cExpect(exc.notFound).toBe(true);
		});
		
		await testFS.writeTxtFile(fName, '123');
		cExpect(await testFS.checkFilePresence(fName)).toBe(true);
		await testFS.listFolder(fName)
		.then(() => {
			cFail('listing should fail on path that points to file')
		}, (exc: FileException) => {
			cExpect(exc.notDirectory).toBe(true);
		});

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 4;
specs.its.push(it);

it = { expectation: 'lists folder' };
it.func = async function(done: Function) {
	try {
		let fName = 'f1/f2';
		await testFS.makeFolder('f1/f2');
		await testFS.writeTxtFile(fName+'/file1', '');
		await testFS.writeTxtFile(fName+'/folder1/file2', '');

		let lst = await testFS.listFolder(fName);
		cExpect(Array.isArray(lst)).toBe(true);
		cExpect(lst.length).toBe(2);
		for (let entry of lst) {
			if (entry.isFile) {
				cExpect(entry.name).toBe('file1');
			} else if (entry.isFolder) {
				cExpect(entry.name).toBe('folder1');
			} else {
				cFail(`folder listing has unknown type: ${JSON.stringify(entry, null, '  ')}`);
			}
		}

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 4;
specs.its.push(it);

Object.freeze(exports);