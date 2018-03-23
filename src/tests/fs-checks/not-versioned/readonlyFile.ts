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
	description: '.readonlyFile',
	its: []
};

let it: SpecIt = { expectation: 'fails for non-existent file' };
it.func = async function(done: Function) {
	try {
		let fName = 'unknown-file';
		cExpect(await testFS.checkFilePresence(fName)).toBe(false);
		try {
			await testFS.readonlyFile(fName);
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

it = { expectation: 'gives file object' };
it.func = async function(done: Function) {
	try {
		let original = 'Should I be at BlackHat conference or working?';
		let fName = 'file';
		await testFS.writeTxtFile(fName, original);
		
		let file = await testFS.readonlyFile(fName);
		cExpect(typeof file).toBe('object');
		cExpect(file.writable).toBe(false);
		cExpect(!!file.v).toBe(!!testFS.v);
		cExpect(file.name).toBe(fName, 'file object should have file name');
		cExpect(file.isNew).toBe(false, 'readonly file must exist');		
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 5;
specs.its.push(it);

Object.freeze(exports);