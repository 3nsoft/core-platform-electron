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
	description: '.makeFolder',
	its: []
};

let it: SpecIt = { expectation: 'creates in existing parent' };
it.func = async function(done: Function) {
	try {
		let fName = 'folder';
		cExpect(await testFS.checkFolderPresence(fName)).toBe(false);
		await testFS.makeFolder(fName);
		cExpect(await testFS.checkFolderPresence(fName)).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 2;
specs.its.push(it);

it = { expectation: 'is a no-op, when folder exists, and a call is not exclusive' };
it.func = async function(done: Function) {
	try {
		for (let fName of [ 'folder2', 'parent2/folder2' ]) {
			cExpect(await testFS.checkFolderPresence(fName)).toBe(false);
			await testFS.makeFolder(fName);
			cExpect(await testFS.checkFolderPresence(fName)).toBe(true);
			await testFS.makeFolder(fName)
			.catch((e) => {
				cFail('non exclusive creation should not throw');
			});
			cExpect(await testFS.checkFolderPresence(fName)).toBe(true);
		}
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 3*2;
specs.its.push(it);

it = { expectation: 'exclusive creation fails if folder exists' };
it.func =	async function(done: Function) {
	try {
		for (let fName of [ 'folder3', 'parent3/folder3' ]) {
			cExpect(await testFS.checkFolderPresence(fName)).toBe(false);
			await testFS.makeFolder(fName);
			cExpect(await testFS.checkFolderPresence(fName)).toBe(true);
			await testFS.makeFolder(fName, true)
			.then(() => {
				cFail('Exclusive creation of folder fails to throw.');
			}, (e: FileException) => {
				if (!e.alreadyExists) { cFail('incorrect exception'); }
			});
		}
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 2*2;
specs.its.push(it);

it = { expectation: 'creates parent folder(s) on the way' };
it.func =async function(done: Function) {
	try {
		let fName = 'folder';
		let grParent = 'grand-parent';
		let parent2 = 'grand-parent/parent2';
		let path = `${parent2}/${fName}`;
		cExpect(await testFS.checkFolderPresence(grParent)).toBe(false);
		cExpect(await testFS.checkFolderPresence(parent2)).toBe(false);
		cExpect(await testFS.checkFolderPresence(path)).toBe(false);
		await testFS.makeFolder(path);
		cExpect(await testFS.checkFolderPresence(path)).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 4;
specs.its.push(it);

it = { expectation: 'can handle concurrent creation' }
it.func = async function(done: Function) {
	try {
		let path = 'concurrent/a/b/c/d/e/f/g/h';
		cExpect(await testFS.checkFolderPresence(path)).toBe(false);
		let concurrentTasks: Promise<void>[] = [];
		for (let i=0; i < 10; i+=1) {
			concurrentTasks.push(testFS.makeFolder(path));
		}
		await Promise.all(concurrentTasks);
		cExpect(await testFS.checkFolderPresence(path)).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 2;
specs.its.push(it);

Object.freeze(exports);