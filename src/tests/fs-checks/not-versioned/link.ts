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
	description: '.link, when linking in the same storage,',
	its: []
};

let it: SpecIt = { expectation: 'links readonly file' };
it.func = async function(done: Function) {
	try {
		const original = 'Should I be at BlackHat conference or working?';
		const fName = 'file1';
		await testFS.writeTxtFile(fName, original, true);
		let file = await testFS.readonlyFile(fName);

		const linkPath = 'link1';
		await testFS.link(linkPath, file);

		const link = await testFS.readLink(linkPath);
		cExpect(link.isFile).toBe(true, 'this link should be for a file');
		cExpect(link.readonly).toBe(true, 'target extractable via this link should be readonly');

		file = (await link.target()) as web3n.files.File;
		cExpect(!!file).toBe(true, 'target should be instantiated');
		cExpect(file.writable).toBe(false);
		cExpect(await file.readTxt()).toBe(original);

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 5;
specs.its.push(it);

it = { expectation: 'links writable file' };
it.func = async function(done: Function) {
	try {
		const original = 'Should I be at BlackHat conference or working?';
		const fName = 'file2';
		await testFS.writeTxtFile(fName, original, true);
		let file = await testFS.writableFile(fName);

		const linkPath = 'link2';
		await testFS.link(linkPath, file);

		const link = await testFS.readLink(linkPath);
		cExpect(link.isFile).toBe(true, 'this link should be for a file');
		cExpect(link.readonly).toBe(false, 'this link should be writable');

		file = (await link.target()) as web3n.files.WritableFile;
		cExpect(!!file).toBe(true, 'target should be instantiated');
		cExpect(file.writable).toBe(true);
		cExpect(await file.readTxt()).toBe(original);
		const newTxt = 'I better work. A-a-a!!!';
		await file.writeTxt(newTxt);
		cExpect(await file.readTxt()).toBe(newTxt);

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 6;
specs.its.push(it);

it = { expectation: 'links writable folder' };
it.func = async function(done: Function) {
	try {
		const original = 'Should I be at BlackHat conference or working?';
		const folderName = 'folder1';
		const fName = 'file1';
		await testFS.writeTxtFile(`${folderName}/${fName}`, original, true);
		let folder = await testFS.writableSubRoot(folderName);

		const linkPath = 'link3';
		await testFS.link(linkPath, folder);

		const link = await testFS.readLink(linkPath);
		cExpect(link.isFolder).toBe(true, 'this link should be for a folder');
		cExpect(link.readonly).toBe(false, 'this link should be writable');

		folder = (await link.target()) as web3n.files.WritableFS;
		cExpect(!!folder).toBe(true, 'target should be instantiated');
		cExpect(folder.writable).toBe(true);
		cExpect(await folder.readTxtFile(fName)).toBe(original);
		const newTxt = 'I better work. A-a-a!!!';
		await folder.writeTxtFile(fName, newTxt);
		cExpect(await folder.readTxtFile(fName)).toBe(newTxt);

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 6;
specs.its.push(it);

it = { expectation: 'creates enslosing folder' };
it.func = async function(done: Function) {
	try {
		const original = 'Should I be at BlackHat conference or working?';
		const fPath = 'folder1/file1';
		await testFS.writeTxtFile(fPath, original, true);
		let file = await testFS.readonlyFile(fPath);

		const linkFolder = `link's folder`;
		cExpect(await testFS.checkFolderPresence(linkFolder)).toBe(false);

		const linkPath = `${linkFolder}/link`;
		await testFS.link(linkPath, file);

		cExpect(await testFS.checkFolderPresence(linkFolder)).toBe(true);
		
		const link = await testFS.readLink(linkPath);
		cExpect(link.isFile).toBe(true, 'this link should be for a file');

		file = (await link.target()) as web3n.files.File;
		cExpect(!!file).toBe(true, 'target should be instantiated');
		cExpect(await file.readTxt()).toBe(original);

	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 5;
specs.its.push(it);
