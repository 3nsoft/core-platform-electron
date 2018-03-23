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
declare var testFS: web3n.files.WritableFS;
let cExpect = expect;
let cFail = fail;
function collectAllExpectations(): void {};

export let specs: SpecDescribe = {
	description: '.writableFile',
	its: []
};

let it: SpecIt = { expectation: 'fails for non-existing file, in non-create mode' };
it.func = async function(done: Function) {
	try {
		let fName = 'unknown-file';
		cExpect(await testFS.checkFilePresence(fName)).toBe(false);
		try {
			await testFS.writableFile(fName, false);
			cFail('getting file object must fail, when file does not exist');
		} catch (err) {
			cExpect((err as FileException).notFound).toBe(true);
			if (!err.notFound) { throw err; }
		}
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 2;
specs.its.push(it);

it = { expectation: 'fails for existing file, in exclusive create mode' };
it.func = async function(done: Function) {
	try {
		let fName = 'file';
 		await testFS.writeTxtFile(fName, '');
		cExpect(await testFS.checkFilePresence(fName)).toBe(true);
		try {
			await testFS.writableFile(fName, true, true);
			cFail('getting file object must fail, when file exists');
		} catch (err) {
			cExpect((err as FileException).alreadyExists).toBe(true);
			if (!err.alreadyExists) { throw err; }
		}
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 2;
specs.its.push(it);

it = { expectation: 'gives file object for non-existing file' };
it.func = async function(done: Function) {
	try {
		let fName = 'new-file';
		cExpect(await testFS.checkFilePresence(fName)).toBe(false);
		
		let file = await testFS.writableFile(fName);
		cExpect(typeof file).toBe('object');
		cExpect(file.name).toBe(fName, 'file object should have file name');
		cExpect(file.isNew).toBe(true, 'readonly file must exist');
		cExpect(file.writable).toBe(true);
		cExpect(!!file.v).toBe(!!testFS.v);
		
		cExpect(await testFS.checkFilePresence(fName)).toBe(false, 'File does not exist, while nothing has been written to it.');

		let txt = 'some text';
		await file.writeTxt(txt);
		cExpect(await testFS.checkFilePresence(fName)).toBe(true, 'File is created on the first write.');
		cExpect(await file.readTxt()).toBe(txt);

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 9;
specs.its.push(it);

Object.freeze(exports);