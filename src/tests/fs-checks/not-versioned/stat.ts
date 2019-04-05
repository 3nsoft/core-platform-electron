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

type FileException = web3n.files.FileException;
declare var testFS: web3n.files.WritableFS;

export let specs: SpecDescribe = {
	description: '.stat',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent path' };
it.func = async function() {
	let fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	await testFS.stat(fName)
	.then(() => {
		fail('stat-ing must fail, when path does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBe(true);
		if (!err.notFound) { throw err; }
	});
};
it.numOfExpects = 2;
specs.its.push(it);

it = { expectation: 'stats file' };
it.func = async function() {
	let original = 'Should I be at BlackHat conference or working?';
	let originalFileSize = original.length;
	let fName = 'file1';
	await testFS.writeTxtFile(fName, original);
	let stat = await testFS.stat(fName);
	expect(typeof stat).toBe('object');
	expect(stat).not.toBeNull();		
	expect(stat.isFile).toBe(true, 'flag indicating that path points to file');
	expect(stat.size).toBe(originalFileSize, 'file size');
	expect(stat.writable).toBe(true);
	
	let sndTxt = 'I better work!';
	let sndVersionFileSize = sndTxt.length;
	await testFS.writeTxtFile(fName, sndTxt);
	stat = await testFS.stat(fName);
	expect(stat.isFile).toBe(true, 'flag indicating that path points to file');
	expect(stat.size).toBe(sndVersionFileSize, 'file size');
	expect(stat.writable).toBe(true);

	const roFS = await testFS.readonlySubRoot('');
	stat = await roFS.stat(fName);
	expect(stat.isFile).toBe(true, 'flag indicating that path points to file');
	expect(stat.size).toBe(sndVersionFileSize, 'file size');
	expect(stat.writable).toBe(false);

};
it.numOfExpects = 11;
specs.its.push(it);

it = { expectation: 'stats folder' };
it.func = async function() {
	const fName = 'folder1';
	await testFS.makeFolder(fName);
	let stat = await testFS.stat(fName);
	expect(typeof stat).toBe('object');
	expect(stat).not.toBeNull();
	expect(stat.isFolder).toBe(true, 'flag indicating that path points to folder');
	expect(stat.writable).toBe(true);

	const roFS = await testFS.readonlySubRoot('');
	stat = await roFS.stat(fName);
	expect(stat.isFolder).toBe(true, 'flag indicating that path points to folder');
	expect(stat.writable).toBe(false);

};
it.numOfExpects = 6;
specs.its.push(it);

Object.freeze(exports);