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
	description: '.writeTxtFile',
	its: []
};

let it: SpecIt = { expectation: 'if not allowed to create, fails for missing file' };
it.func = async function(done: Function) {
	try {
		let txt = 'Should I be at BlackHat conference or working?';
		await testFS.writeTxtFile('non-existing-file', txt, false)
		.then(() => {
			cFail('should fail for missing file');
		}, (e: FileException) => {
			cExpect(e.notFound).toBe(true);
		});
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 1;
specs.its.push(it);

it = { expectation: 'creates file in existing folder' };
it.func = async function(done: Function) {
	try {
		let path = 'file1';
		let txt = 'Should I be at BlackHat conference or working?';
		cExpect(await testFS.checkFilePresence(path)).toBe(false);
		await testFS.writeTxtFile(path, txt);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
		cExpect(await testFS.readTxtFile(path)).toBe(txt);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 3;
specs.its.push(it);

it = { expectation: 'creates parent folder(s) on the way' };
it.func = async function(done: Function) {
	try {
		let fName = 'file2';
		let grParent = 'grand-parent';
		let parent2 = 'grand-parent/parent2';
		let path = `${parent2}/${fName}`;
		cExpect(await testFS.checkFolderPresence(grParent)).toBe(false);
		cExpect(await testFS.checkFolderPresence(parent2)).toBe(false);
		cExpect(await testFS.checkFolderPresence(path)).toBe(false);
		let txt = 'Should I be at BlackHat conference or working?';
		await testFS.writeTxtFile(path, txt);
		cExpect(await testFS.checkFolderPresence(grParent)).toBe(true);
		cExpect(await testFS.checkFolderPresence(parent2)).toBe(true);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
		cExpect(await testFS.readTxtFile(path)).toBe(txt);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 7;
specs.its.push(it);

it = { expectation: 'over-writes existing file with a non-exclusive call' };
it.func = async function(done: Function) {
	try {
		let path = 'file3';
		// setup initial file
		let initTxt = 'Should I be at BlackHat conference or working?';
		await testFS.writeTxtFile(path, initTxt);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
		cExpect(await testFS.readTxtFile(path)).toBe(initTxt);
		// write new file content
		let newTxt = 'Work gives tangible benefits.\nRetire and go anywhere.';
		await testFS.writeTxtFile(path, newTxt);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
		cExpect(await testFS.readTxtFile(path)).toBe(newTxt);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 4;
specs.its.push(it);

it = { expectation: 'exclusive-create write throws when file already exists' };
it.func = async function(done: Function) {
	try {
		let path = 'file4';
		// setup initial file
		let initTxt = 'Should I be at BlackHat conference or working?';
		await testFS.writeTxtFile(path, initTxt);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
		// try an exclusive write
		let newTxt = 'Work gives tangible benefits.\nRetire and go anywhere.';
		await testFS.writeTxtFile(path, newTxt, true, true)
		.then(() => {
			cFail('exclusive-create write operation must fail, when file exists.');
		}, (exc: FileException) => {
			cExpect(exc.alreadyExists).toBe(true);
		});
		cExpect(await testFS.readTxtFile(path)).toBe(initTxt, 'initial file content stays intact');
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 3;
specs.its.push(it);

Object.freeze(exports);