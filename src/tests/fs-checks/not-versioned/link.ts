/*
 Copyright (C) 2016 - 2018 3NSoft Inc.
 
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

declare var testFS: web3n.files.WritableFS;

export const specs: SpecDescribe = {
	description: '.link, when linking in the same storage,',
	its: []
};

let it: SpecIt = { expectation: 'links readonly file' };
it.func = async function() {
	const original = 'Should I be at BlackHat conference or working?';
	const fName = 'file1';
	await testFS.writeTxtFile(fName, original, true);
	let file = await testFS.readonlyFile(fName);

	const linkPath = 'link1';
	await testFS.link(linkPath, file);

	const link = await testFS.readLink(linkPath);
	expect(link.isFile).toBe(true, 'this link should be for a file');
	expect(link.readonly).toBe(true, 'target extractable via this link should be readonly');

	file = (await link.target()) as web3n.files.File;
	expect(!!file).toBe(true, 'target should be instantiated');
	expect(file.writable).toBe(false);
	expect(await file.readTxt()).toBe(original);
};
it.numOfExpects = 5;
specs.its.push(it);

it = { expectation: 'links writable file' };
it.func = async function() {
	const original = 'Should I be at BlackHat conference or working?';
	const fName = 'file2';
	await testFS.writeTxtFile(fName, original, true);
	let file = await testFS.writableFile(fName);

	const linkPath = 'link2';
	await testFS.link(linkPath, file);

	const link = await testFS.readLink(linkPath);
	expect(link.isFile).toBe(true, 'this link should be for a file');
	expect(link.readonly).toBe(false, 'this link should be writable');

	file = (await link.target()) as web3n.files.WritableFile;
	expect(!!file).toBe(true, 'target should be instantiated');
	expect(file.writable).toBe(true);
	expect(await file.readTxt()).toBe(original);
	const newTxt = 'I better work. A-a-a!!!';
	await file.writeTxt(newTxt);
	expect(await file.readTxt()).toBe(newTxt);
};
it.numOfExpects = 6;
specs.its.push(it);

it = { expectation: 'links writable folder' };
it.func = async function() {
	const original = 'Should I be at BlackHat conference or working?';
	const folderName = 'folder1';
	const fName = 'file1';
	await testFS.writeTxtFile(`${folderName}/${fName}`, original, true);
	let folder = await testFS.writableSubRoot(folderName);

	const linkPath = 'link3';
	await testFS.link(linkPath, folder);

	const link = await testFS.readLink(linkPath);
	expect(link.isFolder).toBe(true, 'this link should be for a folder');
	expect(link.readonly).toBe(false, 'this link should be writable');

	folder = (await link.target()) as web3n.files.WritableFS;
	expect(!!folder).toBe(true, 'target should be instantiated');
	expect(folder.writable).toBe(true);
	expect(await folder.readTxtFile(fName)).toBe(original);
	const newTxt = 'I better work. A-a-a!!!';
	await folder.writeTxtFile(fName, newTxt);
	expect(await folder.readTxtFile(fName)).toBe(newTxt);
};
it.numOfExpects = 6;
specs.its.push(it);

it = { expectation: 'creates enslosing folder' };
it.func = async function() {
	const original = 'Should I be at BlackHat conference or working?';
	const fPath = 'folder1/file1';
	await testFS.writeTxtFile(fPath, original, true);
	let file = await testFS.readonlyFile(fPath);

	const linkFolder = `link's folder`;
	expect(await testFS.checkFolderPresence(linkFolder)).toBe(false);

	const linkPath = `${linkFolder}/link`;
	await testFS.link(linkPath, file);

	expect(await testFS.checkFolderPresence(linkFolder)).toBe(true);
	
	const link = await testFS.readLink(linkPath);
	expect(link.isFile).toBe(true, 'this link should be for a file');

	file = (await link.target()) as web3n.files.File;
	expect(!!file).toBe(true, 'target should be instantiated');
	expect(await file.readTxt()).toBe(original);
};
it.numOfExpects = 5;
specs.its.push(it);
