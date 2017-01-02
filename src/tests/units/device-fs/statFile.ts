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
	description: '.statFile',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent file' };
it.func = async function(done: Function) {
	try {
		let fName = 'unknown-file';
		cExpect(await testFS.checkFilePresence(fName)).toBe(false);
		await testFS.statFile(fName)
		.then(() => {
			cFail('stat-ing must fail, when file does not exist');
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

it = { expectation: 'stats file' };
it.func = async function(done: Function) {
	try {
		let original = 'Should I be at BlackHat conference or working?';
		let originalFileSize = original.length;
		let fName = 'file1';
		await testFS.writeTxtFile(fName, original);
		let stat = await testFS.statFile(fName);
		cExpect(typeof stat).toBe('object');
		cExpect(stat).not.toBeNull();		
		cExpect(stat.size).toBe(originalFileSize, 'file size');
		
		let sndTxt = 'I better work!';
		let sndVersionFileSize = sndTxt.length;
		await testFS.writeTxtFile(fName, sndTxt);
		stat = await testFS.statFile(fName);
		cExpect(stat.size).toBe(sndVersionFileSize, 'file size');
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
specs.its.push(it);

Object.freeze(exports);