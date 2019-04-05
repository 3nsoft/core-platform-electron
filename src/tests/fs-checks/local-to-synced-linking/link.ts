/*
 Copyright (C) 2016, 2018 3NSoft Inc.
 
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

declare var syncedTestFS: web3n.files.WritableFS;
declare var localTestFS: web3n.files.WritableFS;

export let specs: SpecDescribe = {
	description: '.link, when linking from local into synced storage,',
	its: []
};

let it: SpecIt = { expectation: 'links readonly file' };
it.func = async function() {
	let original = 'Should I be at BlackHat conference or working?';
	let fName = 'file1';
	await syncedTestFS.writeTxtFile(fName, original, true);
	let file = await syncedTestFS.readonlyFile(fName);

	let linkPath = 'link1';
	await localTestFS.link(linkPath, file);

	let link = await localTestFS.readLink(linkPath);
	expect(link.isFile).toBe(true, 'this link should be for a file');
	expect(link.readonly).toBe(true, 'this link should be readonly');

	file = (await link.target()) as web3n.files.ReadonlyFile;
	expect(!!file).toBe(true, 'target should be instantiated');
	expect(await file.readTxt()).toBe(original);
	expect(file.writable).toBe(false);
};
it.numOfExpects = 5;
specs.its.push(it);

it = { expectation: 'links writable file' };
it.func = async function() {
	let original = 'Should I be at BlackHat conference or working?';
	let fName = 'file1';
	await syncedTestFS.writeTxtFile(fName, original, true);
	let file = await syncedTestFS.writableFile(fName);

	let linkPath = 'link1';
	await localTestFS.link(linkPath, file);

	let link = await localTestFS.readLink(linkPath);
	expect(link.isFile).toBe(true, 'this link should be for a file');
	expect(link.readonly).toBe(false, 'this link should be writable');

	file = (await link.target()) as web3n.files.WritableFile;
	expect(!!file).toBe(true, 'target should be instantiated');
	expect(await file.readTxt()).toBe(original);
	let newTxt = 'I better work. A-a-a!!!';
	await file.writeTxt(newTxt);
	expect(await file.readTxt()).toBe(newTxt);
};
it.numOfExpects = 5;
specs.its.push(it);

it = { expectation: 'links writable folder' };
it.func = async function() {
	let original = 'Should I be at BlackHat conference or working?';
	let folderName = 'folder1';
	let fName = 'file1';
	await syncedTestFS.writeTxtFile(`${folderName}/${fName}`, original, true);
	let folder = await syncedTestFS.writableSubRoot(folderName);

	let linkPath = 'link1';
	await localTestFS.link(linkPath, folder);

	let link = await localTestFS.readLink(linkPath);
	expect(link.isFolder).toBe(true, 'this link should be for a folder');
	expect(link.readonly).toBe(false, 'this link should be writable');

	folder = (await link.target()) as web3n.files.WritableFS;
	expect(!!folder).toBe(true, 'target should be instantiated');
	expect(await folder.readTxtFile(fName)).toBe(original);
	let newTxt = 'I better work. A-a-a!!!';
	await folder.writeTxtFile(fName, newTxt);
	expect(await folder.readTxtFile(fName)).toBe(newTxt);
};
it.numOfExpects = 5;
specs.its.push(it);
