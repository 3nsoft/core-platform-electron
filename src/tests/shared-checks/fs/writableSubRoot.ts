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
	description: '.writableSubRoot',
	its: []
};

let it: SpecIt = { expectation: 'creates sub-root based on existing folder' };
it.func = async function(done: Function) {
	try {
		let path = 'sub-root';
		await testFS.makeFolder(path);
		cExpect(await testFS.checkFolderPresence(path)).toBe(true);
		let subRoot = await testFS.writableSubRoot(path);
		cExpect(subRoot).toBeTruthy();
		cExpect(subRoot.writable).toBe(true);
		cExpect(subRoot.versioned).toBe(testFS.versioned);
		cExpect(Array.isArray(await subRoot.listFolder(''))).toBe(true);
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
		let path = 'sub-root2';
		cExpect(await testFS.checkFolderPresence(path)).toBe(false);
		let subRoot = await testFS.writableSubRoot(path);
		cExpect(subRoot).toBeTruthy();
		cExpect(subRoot.writable).toBe(true);
		cExpect(subRoot.versioned).toBe(testFS.versioned);
		cExpect(Array.isArray(await subRoot.listFolder(''))).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 5;
specs.its.push(it);

it = { expectation: 'creates parent folder(s) on the way' };
it.func =async function(done: Function) {
	try {
		let fName = 'sub-root';
		let grParent = 'grand-parent';
		let parent = 'grand-parent/parent';
		let path = `${parent}/${fName}`;
		cExpect(await testFS.checkFolderPresence(grParent)).toBe(false);
		cExpect(await testFS.checkFolderPresence(parent)).toBe(false);
		cExpect(await testFS.checkFolderPresence(path)).toBe(false);
		let subRoot = await testFS.writableSubRoot(path);
		cExpect(subRoot).toBeTruthy();
		cExpect(subRoot.writable).toBe(true);
		cExpect(subRoot.versioned).toBe(testFS.versioned);
		cExpect(Array.isArray(await subRoot.listFolder(''))).toBe(true);
		cExpect(await testFS.checkFolderPresence(path)).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 8;
specs.its.push(it);

Object.freeze(exports);