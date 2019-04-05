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
import { bytesSync as randomBytes } from '../../../lib-common/random-node';
import { bytesEqual as byteArraysEqual }
	from '../../libs-for-tests/bytes-equal';

type FileException = web3n.files.FileException;
declare var testFS: web3n.files.WritableFS;
let testRandomBytes = randomBytes;
let bytesEqual = byteArraysEqual;

export let specs: SpecDescribe = {
	description: '.getByteSink',
	its: []
};

let it: SpecIt = { expectation: 'if not allowed to create, fails for missing file' };
it.func = async function() {
	try {
		await testFS.getByteSink('non-existing-file', false);
		fail('should fail for missing file');
	} catch (e) {
		expect((e as FileException).notFound).toBe(true);
	}
};
it.numOfExpects = 1;
specs.its.push(it);

it = { expectation: 'creates file in existing folder' };
it.func = async function() {
	let path = 'file1';
	let content = testRandomBytes(2*1024);
	expect(await testFS.checkFilePresence(path)).toBe(false);

	let { sink, version: v } = await testFS.v!.getByteSink(path);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	expect(await sink.getSize()).toBe(0);
	for (let pointer=0; pointer < content.length; pointer+=250) {
		let chunkEnd = pointer + 250;
		await sink.write(content.subarray(pointer, chunkEnd));
		expect(await sink.getSize()).toBe(
			Math.min(chunkEnd, content.length));
	}
	expect(await sink.getSize()).toBe(content.length);

	// XXX very often this following call hangs, timeout doesn't help. why?
	//		investigate
	await sink.write(null);

	let { bytes, version } = await testFS.v!.readBytes(path);
	expect(!!bytes).toBe(true);
	expect(bytesEqual(content, bytes!)).toBe(true);
	expect(version).toBe(v);
};
it.timeout = 7000;
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

	let { sink } = await testFS.v!.getByteSink(path);
	expect(await testFS.checkFolderPresence(grParent)).toBe(true);
	expect(await testFS.checkFolderPresence(parent2)).toBe(true);
	expect(await testFS.checkFilePresence(path)).toBe(true);
	// note that file existed before sink closing
	await sink.write(null);
};
it.numOfExpects = 6;
specs.its.push(it);

it = { expectation: 'opens existing file' };
it.func = async function() {
	let path = 'file2';
	let bytes = testRandomBytes(2*1024);
	let originalSize = bytes.length;
	let v = await testFS.v!.writeBytes(path, bytes);
	expect(await testFS.checkFilePresence(path)).toBe(true);

	let { sink, version } = await testFS.v!.getByteSink(path);
	expect(version).toBeGreaterThan(v, 'it should be next file version');

	// XXX currently, seek doesn't work, getPosition is not present, and file
	//		is truncated, unlike device-based sinks. Should fix this.

	// expect(await sink.getSize()).toBe(originalSize, 'Existing file should be opened as is');
	// expect(await sink.getPosition!()).toBe(0);
	// await sink.seek!(originalSize);
	// expect(await sink.getPosition!()).toBe(originalSize);
	// await sink.write(bytes);
	// expect(await sink.getSize()).toBe(originalSize + bytes.length);
	await sink.write(null);
};
specs.its.push(it);

Object.freeze(exports);