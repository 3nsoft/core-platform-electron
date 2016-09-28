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

type FileException = Web3N.Files.FileException;
declare var testFS: Web3N.Files.FS;
let cExpect = expect;
let cFail = fail;
function collectAllExpectations(): void {};

export let specs: SpecDescribe = {
	description: '.deleteFile',
	its: []
};

let it: SpecIt = { expectation: 'cannot delete non-existing file' };
it.func = async function(done: Function) {
	try {
		let fName = 'non-existing-file';
		cExpect(await testFS.checkFilePresence(fName)).toBe(false);
		await testFS.deleteFile(fName)
		.then(() => {
			cFail('deleting non-existing file must fail');
		}, (exc: FileException) => {
			cExpect(exc.notFound).toBe(true);
		});

		await testFS.makeFolder(fName);
		cExpect(await testFS.checkFolderPresence(fName)).toBe(true);
		await testFS.deleteFile(fName)
		.then(() => {
			cFail('deleting folder as file must fail');
		}, (exc: FileException) => {
			cExpect(exc.notFile).toBe(true, 'folder is not a file');
		});
		
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 4;
specs.its.push(it);

it = { expectation: 'deletes file' };
it.func = async function(done: Function) {
	try {
		for (let fName of [ 'file1', 'folder/file1' ]) {
			await testFS.writeTxtFile(fName, '');
			cExpect(await testFS.checkFilePresence(fName)).toBe(true);
			await testFS.deleteFile(fName);
			cExpect(await testFS.checkFilePresence(fName)).toBe(false);
		}
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 4;
specs.its.push(it);

Object.freeze(exports);