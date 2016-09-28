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
	description: '.makeSubRoot',
	its: []
};

let it: SpecIt = { expectation: 'creates sub-root based on existing folder' };
it.func = async function(done: Function) {
	try {
		let path = 'sub-root';
		await testFS.makeFolder(path);
		cExpect(await testFS.checkFolderPresence(path)).toBe(true);
		let subRoot = await testFS.makeSubRoot(path);
		cExpect(subRoot).toBeTruthy();
		cExpect(Array.isArray(await subRoot.listFolder(''))).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 3;
specs.its.push(it);

it = { expectation: 'creates new folder for a sub-root' };
it.func = async function(done: Function) {
	try {
		let path = 'sub-root2';
		cExpect(await testFS.checkFolderPresence(path)).toBe(false);
		let subRoot = await testFS.makeSubRoot(path);
		cExpect(subRoot).toBeTruthy();
		cExpect(Array.isArray(await subRoot.listFolder(''))).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 3;
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
		let subRoot = await testFS.makeSubRoot(path);
		cExpect(subRoot).toBeTruthy();
		cExpect(Array.isArray(await subRoot.listFolder(''))).toBe(true);
		cExpect(await testFS.checkFolderPresence(path)).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 6;
specs.its.push(it);

Object.freeze(exports);