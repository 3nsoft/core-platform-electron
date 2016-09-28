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
import { bytes as randomBytes } from '../../../../lib-client/random-node';
import { bytesEqual as byteArraysEqual }
	from '../../../libs-for-tests/bytes-equal';

type FileException = Web3N.Files.FileException;
declare var testFS: Web3N.Files.FS;
let testRandomBytes = randomBytes;
let bytesEqual = byteArraysEqual;
let cExpect = expect;
let cFail = fail;
function collectAllExpectations(): void {};

export let specs: SpecDescribe = {
	description: '.getByteSource',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent file' };
it.func = async function(done: Function) {
	try {
		await testFS.getByteSource('non-existing-file')
		.then(() => {
			cFail('should fail for missing file');
		}, (e: FileException) => {
			cExpect(e.notFound).toBe(true);
		});
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 1;
specs.its.push(it);

it = { expectation: 'reads file bytes with seeking available' };
it.func = async function(done: Function) {
	try {
		let original = testRandomBytes(12*1024+3);
		let fName = 'file1';
		await testFS.writeBytes(fName, original);

		let src = await testFS.getByteSource(fName);
		cExpect(src.seek).toBeTruthy();
		cExpect(await src.getPosition()).toBe(0);

		let chunk = await src.read(200);
		cExpect(bytesEqual(chunk, original.subarray(0, 200))).toBe(true);

		await src.seek(3000);
		cExpect(await src.getPosition()).toBe(3000, 'seek method changes position in file.');
		chunk = await src.read(200);
		cExpect(bytesEqual(chunk, original.subarray(3000, 3200))).toBe(true);

		await src.seek(11000);
		cExpect(await src.getPosition()).toBe(11000, 'seek method changes position in file.');
		chunk = await src.read(200);
		cExpect(bytesEqual(chunk, original.subarray(11000, 11200))).toBe(true);
		
		await src.seek(1000);
		cExpect(await src.getPosition()).toBe(1000);
		chunk = await src.read(200);
		cExpect(bytesEqual(chunk, original.subarray(1000, 1200))).toBe(true);

		chunk = await src.read(null);
		cExpect(bytesEqual(chunk, original.subarray(1200))).toBe(true, 'read should be from current position to file\'s end');
		
		cExpect(await src.read(100)).toBeNull('null is returned, whewn there are no more bytes to read');

		fName = 'file2';
		await testFS.writeBytes(fName, new Uint8Array(0));
		src = await testFS.getByteSource(fName);
		cExpect(await src.read(100)).toBeNull('reading empty file should produce empty array');
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 12;
specs.its.push(it);

Object.freeze(exports);