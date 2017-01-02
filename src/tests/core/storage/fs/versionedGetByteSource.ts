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

import { SpecDescribe, SpecIt } from '../../../libs-for-tests/spec-module';
import { bytes as randomBytes } from '../../../../lib-client/random-node';
import { bytesEqual as byteArraysEqual }
	from '../../../libs-for-tests/bytes-equal';

type FileException = web3n.files.FileException;
declare var testFS: web3n.storage.FS;
let testRandomBytes = randomBytes;
let bytesEqual = byteArraysEqual;
let cExpect = expect;
let cFail = fail;
function collectAllExpectations(): void {};

export let specs: SpecDescribe = {
	description: '.versionedGetByteSource',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent file' };
it.func = async function(done: Function) {
	try {
		await testFS.versionedGetByteSource('non-existing-file')
		.then((a) => {
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
		let v1 = await testFS.versionedWriteBytes(fName, original);

		let { src, version } = await testFS.versionedGetByteSource(fName);
		cExpect(src.seek).toBeTruthy();
		cExpect(version).toBe(v1);
		cExpect(await src.getPosition!()).toBe(0);

		let chunk = await src.read(200);
		cExpect(bytesEqual(chunk!, original.subarray(0, 200))).toBe(true);

		await src.seek!(3000);
		cExpect(await src.getPosition!()).toBe(3000, 'seek method changes position in file.');
		chunk = await src.read(200);
		cExpect(bytesEqual(chunk!, original.subarray(3000, 3200))).toBe(true);

		await src.seek!(11000);
		cExpect(await src.getPosition!()).toBe(11000, 'seek method changes position in file.');
		chunk = await src.read(200);
		cExpect(bytesEqual(chunk!, original.subarray(11000, 11200))).toBe(true);
		
		await src.seek!(1000);
		cExpect(await src.getPosition!()).toBe(1000);
		chunk = await src.read(200);
		cExpect(bytesEqual(chunk!, original.subarray(1000, 1200))).toBe(true);

		chunk = await src.read(undefined);
		cExpect(bytesEqual(chunk!, original.subarray(1200))).toBe(true, 'read should be from current position to file\'s end');
		
		cExpect(typeof (await src.read(100))).toBe('undefined', 'null is returned, whewn there are no more bytes to read');

		let v2 = await testFS.versionedWriteBytes(fName, new Uint8Array(0));
		cExpect(v2).toBeGreaterThan(v1);
		({ src, version } = await testFS.versionedGetByteSource(fName));
		cExpect(typeof (await src.read(100))).toBe('undefined', 'reading empty file should produce empty array');
		cExpect(version).toBe(v2);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 15;
specs.its.push(it);

Object.freeze(exports);