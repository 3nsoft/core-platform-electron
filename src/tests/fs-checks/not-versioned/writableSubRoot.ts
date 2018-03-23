/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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
const cExpect = expect;
const cFail = fail;
function collectAllExpectations(): void {};

export const specs: SpecDescribe = {
	description: '.writableSubRoot',
	its: []
};

let it: SpecIt = { expectation: 'creates sub-root based on existing folder' };
it.func = async function(done: Function) {
	try {
		const path = 'sub-root';
		await testFS.makeFolder(path);
		cExpect(await testFS.checkFolderPresence(path)).toBe(true);
		const subRoot = await testFS.writableSubRoot(path);
		cExpect(subRoot).toBeTruthy();
		cExpect(subRoot.writable).toBe(true);
		cExpect(!!subRoot.v).toBe(!!testFS.v);
		const lst = await subRoot.listFolder('');
		cExpect(Array.isArray(lst)).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 5;
specs.its.push(it);

it = { expectation: 'creates new folder for a sub-root' };
it.func = async function(done: Function) {
	try {
		const path = 'sub-root2';
		cExpect(await testFS.checkFolderPresence(path)).toBe(false);
		const subRoot = await testFS.writableSubRoot(path);
		cExpect(subRoot).toBeTruthy();
		cExpect(subRoot.writable).toBe(true);
		cExpect(!!subRoot.v).toBe(!!testFS.v);
		const lst = await subRoot.listFolder('');
		cExpect(Array.isArray(lst)).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 5;
specs.its.push(it);

it = { expectation: 'creates parent folder(s) on the way' };
it.func = async function(done: Function) {
	try {
		const fName = 'sub-root';
		const grParent = 'grand-parent';
		const parent = 'grand-parent/parent';
		const path = `${parent}/${fName}`;
		cExpect(await testFS.checkFolderPresence(grParent)).toBe(false);
		cExpect(await testFS.checkFolderPresence(parent)).toBe(false);
		cExpect(await testFS.checkFolderPresence(path)).toBe(false);
		const subRoot = await testFS.writableSubRoot(path);
		cExpect(subRoot).toBeTruthy();
		cExpect(subRoot.writable).toBe(true);
		cExpect(!!subRoot.v).toBe(!!testFS.v);
		const lst = await subRoot.listFolder('');
		cExpect(Array.isArray(lst)).toBe(true);
		cExpect(await testFS.checkFolderPresence(path)).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 8;
specs.its.push(it);

it = { expectation: `concurrently created (on the same folder) sub-roots access the same file tree` };
it.func = async function(done: Function) {
	try {
		const subRootFolder = 'sub-root';
		const promise1 = testFS.writableSubRoot(subRootFolder);
		const promise2 = testFS.writableSubRoot(subRootFolder);

		// create file in one fs
		const fName = 'file 1';
		const fileContent = `Sub-roots to the same folder should display same thing`;
		const subRoot1 = await promise1;
		await subRoot1.writeTxtFile(fName, fileContent);

		// see that file is present via another fs
		const subRoot2 = await promise2;
		cExpect(await subRoot2.checkFilePresence(fName)).toBe(true);
		const readContent = await subRoot2.readTxtFile(fName);
		cExpect(readContent).toBe(fileContent);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
}
it.numOfExpects = 2;
specs.its.push(it);

Object.freeze(exports);