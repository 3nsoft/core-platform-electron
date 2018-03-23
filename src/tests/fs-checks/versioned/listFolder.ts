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
import { deepEqual as jsonDeepEqual } from '../../libs-for-tests/json-equal';

type FileException = web3n.files.FileException;
declare var testFS: web3n.files.WritableFS;
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
		let { lst, version } = await testFS.v!.listFolder('');
		cExpect(Array.isArray(lst)).toBe(true);
		cExpect(typeof version).toBe('number');
		cExpect(lst.length).toBe(0);

		const initVersion = version;

		await testFS.makeFolder('folder1');
		await testFS.writeTxtFile('file1', '');
		await testFS.writeTxtFile('folder1/file2', '');

		({ lst, version } = await testFS.v!.listFolder(''));
		cExpect(lst.length).toBe(2);
		cExpect(version).toBe(initVersion + 2);
		for (let entry of lst) {
			if (entry.isFile) {
				cExpect(entry.name).toBe('file1');
			} else if (entry.isFolder) {
				cExpect(entry.name).toBe('folder1');
			} else {
				cFail(`folder listing has unknown type: ${JSON.stringify(entry, null, '  ')}`);
			}
		}

		let lst2 = (await testFS.v!.listFolder('.')).lst;
		cExpect(deepEqual(lst2, lst)).toBe(true);
		
		lst2 = (await testFS.v!.listFolder('/')).lst;
		cExpect(deepEqual(lst2, lst)).toBe(true);
		
		lst2 = (await testFS.v!.listFolder('../../')).lst;
		cExpect(deepEqual(lst2, lst)).toBe(true);

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 10;
specs.its.push(it);

it = { expectation: 'fails to list non-existing folder' };
it.func = async function(done: Function) {
	try {
		let fName = 'non-existing-folder';
		cExpect(await testFS.checkFolderPresence(fName)).toBe(false);
		try {
			await testFS.listFolder(fName);
			cFail('listing should fail for non-existing folder')
		} catch (exc) {
			cExpect((exc as FileException).notFound).toBe(true);
		}
		
		await testFS.writeTxtFile(fName, '123');
		cExpect(await testFS.checkFilePresence(fName)).toBe(true);
		try {
			await testFS.listFolder(fName)
			cFail('listing should fail on path that points to file')
		} catch (exc) {
			cExpect((exc as FileException).notDirectory).toBe(true);
		}

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
		await testFS.link(fName+'/link1',
			await testFS.readonlyFile(fName+'/folder1/file2'));

		let { lst, version } = await testFS.v!.listFolder(fName);
		cExpect(Array.isArray(lst)).toBe(true);
		cExpect(typeof version).toBe('number');
		cExpect(lst.length).toBe(3);
		for (let entry of lst) {
			if (entry.isFile) {
				cExpect(entry.name).toBe('file1');
			} else if (entry.isFolder) {
				cExpect(entry.name).toBe('folder1');
			} else if (entry.isLink) {
				cExpect(entry.name).toBe('link1');
			} else {
				cFail(`folder listing has unknown type: ${JSON.stringify(entry, null, '  ')}`);
			}
		}

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 6;
specs.its.push(it);

Object.freeze(exports);