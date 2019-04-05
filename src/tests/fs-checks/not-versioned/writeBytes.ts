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
import { bytesSync as randomBytes } from '../../../lib-common/random-node';
import { bytesEqual as byteArraysEqual }
	from '../../libs-for-tests/bytes-equal';

type FileException = web3n.files.FileException;
declare var testFS: web3n.files.WritableFS;
let testRandomBytes = randomBytes;
let bytesEqual = byteArraysEqual;

export let specs: SpecDescribe = {
	description: '.writeBytes',
	its: []
};

let it: SpecIt = { expectation: 'if not allowed to create, fails for missing file' };
it.func = async function() {
	await testFS.writeBytes('non-existing-file', testRandomBytes(123), false)
	.then(() => {
		fail('should fail for missing file');
	}, (e: FileException) => {
		expect(e.notFound).toBe(true);
	});
};
it.numOfExpects = 1;
specs.its.push(it);

it = { expectation: 'creates file in existing folder' };
it.func = async function() {
	let path = 'file1';
	let content = testRandomBytes(2*1024);
	expect(await testFS.checkFilePresence(path)).toBe(false);
	await testFS.writeBytes(path, content);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	let bytes = await testFS.readBytes(path);
	expect(bytesEqual(content, bytes!)).toBe(true);
};
it.numOfExpects = 3;
specs.its.push(it);

it = { expectation: 'creates parent folder(s) on the way' };
it.func = async function() {
	let fName = 'file2';
	let grParent = 'grand-parent';
	let parent2 = 'grand-parent/parent2';
	let path = `${parent2}/${fName}`;
	expect(await testFS.checkFolderPresence(grParent)).toBe(false);
	expect(await testFS.checkFolderPresence(parent2)).toBe(false);
	expect(await testFS.checkFolderPresence(path)).toBe(false);
	let content = testRandomBytes(2*1024);
	await testFS.writeBytes(path, content);
	expect(await testFS.checkFolderPresence(grParent)).toBe(true);
	expect(await testFS.checkFolderPresence(parent2)).toBe(true);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	let bytes = await testFS.readBytes(path);
	expect(bytesEqual(content, bytes!)).toBe(true);
};
it.numOfExpects = 7;
specs.its.push(it);

it = { expectation: 'over-writes existing file with a non-exclusive call' };
it.func = async function() {
	let path = 'file3';
	// setup initial file
	let initBytes = testRandomBytes(123);
	await testFS.writeBytes(path, initBytes);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	let bytes = await testFS.readBytes(path);
	expect(bytesEqual(initBytes, bytes!)).toBe(true);
	// write new file content
	let newContent = testRandomBytes(3223);
	await testFS.writeBytes(path, newContent);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	bytes = await testFS.readBytes(path);
	expect(bytesEqual(newContent, bytes!)).toBe(true);
};
it.numOfExpects = 4;
specs.its.push(it);

it = { expectation: 'exclusive-create write throws when file already exists' };
it.func = async function() {
	let path = 'file4';
	// setup initial file
	let initBytes = testRandomBytes(123);
	await testFS.writeBytes(path, initBytes);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	// try an exclusive write
	let newContent = testRandomBytes(3223);
	await testFS.writeBytes(path, newContent, true, true)
	.then(() => {
		fail('exclusive-create write operation must fail, when file exists.');
	}, (exc: FileException) => {
		expect(exc.alreadyExists).toBe(true);
	});
	let bytes = await testFS.readBytes(path);
	expect(bytesEqual(initBytes, bytes!)).toBe(true, 'initial file content stays intact');
};
it.numOfExpects = 3;
specs.its.push(it);

Object.freeze(exports);