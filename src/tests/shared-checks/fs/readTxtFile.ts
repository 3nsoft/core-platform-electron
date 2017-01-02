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
	description: '.readTxtFile',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent file' };
it.func = async function(done: Function) {
	try {
		let fName = 'unknown-file';
		cExpect(await testFS.checkFilePresence(fName)).toBe(false);
		await testFS.readTxtFile(fName)
		.then(() => {
			cFail('reading text must fail, when file does not exist');
		}, (err: FileException) => {
			cExpect(err.notFound).toBe(true);
			if (!err.notFound) { throw err; }
		});
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 2;
specs.its.push(it);

it = { expectation: 'reads json file' };
it.func = async function(done: Function) {
	try {
		let original = 'Should I be at BlackHat conference or working?';
		let fName = 'file1';
		await testFS.writeTxtFile(fName, original);
		let txt = await testFS.readTxtFile(fName);
		cExpect(txt).toBe(original, 'file read should produce original text');
		
		fName = 'file2';
		await testFS.writeBytes(fName, new Uint8Array(0));
		txt = await testFS.readTxtFile(fName);
		cExpect(txt).toBe('');
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 2;
specs.its.push(it);

Object.freeze(exports);