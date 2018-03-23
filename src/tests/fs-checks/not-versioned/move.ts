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
	description: '.move',
	its: []
};

let it: SpecIt = { expectation: 'cannot move non-existing element' };
it.func = async function(done: Function) {
	try {
		for (let src of ['non/existing/thing', 'thing']) {
			await testFS.move(src, 'thing2')
			.then(() => {
				cFail('move should fail, when source path does not exist');
			}, (exc: FileException) => {
				cExpect(exc.notFound).toBe(true);
			});
		}
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 2;
specs.its.push(it);

it = { expectation: 'cannot move when destination path already exists' };
it.func = async function(done: Function) {
	try {
		let src = 'folder1/file';
		let srcFileContent = '1st file';
		await testFS.writeTxtFile(src, srcFileContent);
		for (let dst of [ 'folder2/file2', 'folder1/file2' ]) {
			await testFS.writeTxtFile(dst, '2nd file');
			cExpect(await testFS.readTxtFile(dst)).not.toBe(srcFileContent);

			await testFS.move(src, dst)
			.then(() => {
				cFail('move should fail, when destination path already exists');
			}, (exc: FileException) => {
				cExpect(exc.alreadyExists).toBe(true);
			});
			cExpect(await testFS.readTxtFile(dst)).not.toBe(srcFileContent, 'existing destination path should stay intact');
		}

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 6;
specs.its.push(it);

it = { expectation: 'moves element in the same folder' };
it.func = async function(done: Function) {
	try {

		// moving folder
		let src = 'folder3/folder';
		let dst = 'folder3/folder-moved';
		await testFS.makeFolder(src);
		cExpect(await testFS.checkFolderPresence(src)).toBe(true);
		cExpect(await testFS.checkFolderPresence(dst)).toBe(false);
		await testFS.move(src, dst);
		cExpect(await testFS.checkFolderPresence(src)).toBe(false);
		cExpect(await testFS.checkFolderPresence(dst)).toBe(true);

		// moving file
		src = 'folder3/file';
		dst = 'folder3/file-moved';
		await testFS.writeTxtFile(src, 'file to move');
		cExpect(await testFS.checkFilePresence(src)).toBe(true);
		cExpect(await testFS.checkFilePresence(dst)).toBe(false);
		await testFS.move(src, dst);
		cExpect(await testFS.checkFilePresence(src)).toBe(false);
		cExpect(await testFS.checkFilePresence(dst)).toBe(true);

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 8;
specs.its.push(it);

it = { expectation: 'moves element to a different folder' };
it.func = async function(done: Function) {
	try {

		// moving folder
		let src = 'folder4/folder';
		let dst = 'folder5/folder-moved';
		await testFS.makeFolder(src);
		cExpect(await testFS.checkFolderPresence(src)).toBe(true);
		cExpect(await testFS.checkFolderPresence(dst)).toBe(false);
		await testFS.move(src, dst);
		cExpect(await testFS.checkFolderPresence(src)).toBe(false);
		cExpect(await testFS.checkFolderPresence(dst)).toBe(true);

		// moving file
		src = 'folder4/file';
		dst = 'folder5/file-moved';
		await testFS.writeTxtFile(src, 'file to move');
		cExpect(await testFS.checkFilePresence(src)).toBe(true);
		cExpect(await testFS.checkFilePresence(dst)).toBe(false);

		// XXX why this second move errs?
		await testFS.move(src, dst);
		cExpect(await testFS.checkFilePresence(src)).toBe(false);
		cExpect(await testFS.checkFilePresence(dst)).toBe(true);

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 8;
specs.its.push(it);

Object.freeze(exports);