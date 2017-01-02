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
	description: '.versionedReadBytes',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent file' };
it.func = async function(done: Function) {
	try {
		let fName = 'unknown-file';
		cExpect(await testFS.checkFilePresence(fName)).toBe(false);
		await testFS.versionedReadBytes(fName)
		.then(() => {
			cFail('reading bytes must fail, when file does not exist');
		}, (err: FileException) => {
			cExpect(err.notFound).toBe(true);
			if (!err.notFound) { throw err; }
		});
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 2;
specs.its.push(it);

it = { expectation: 'reads whole file' };
it.func = async function(done: Function) {
	try {
		let originalBytes = testRandomBytes(12*1024+3);
		let fName = 'file1';
		let v1 = await testFS.versionedWriteBytes(fName, originalBytes);
		let { bytes, version } = await testFS.versionedReadBytes(fName);
		cExpect(bytesEqual(bytes!, originalBytes)).toBe(true, 'file read should produce array with all bytes');
		cExpect(version).toBe(v1, 'file version at reading should exactly the same as that on respective write');
		
		let v2 = await testFS.versionedWriteBytes(fName, new Uint8Array(0));
		cExpect(v2).toBeGreaterThan(v1);
		({ bytes, version } = await testFS.versionedReadBytes(fName));
		cExpect(typeof bytes).toBe('undefined', 'reading empty file should produce undefined');
		cExpect(version).toBe(v2, 'file version at reading should exactly the same as that on respective write');
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 5;
specs.its.push(it);

it = { expectation: 'reads part of the file' };
it.func = async function(done: Function) {
	try {
		let fName = 'file3';
		let originalBytes = testRandomBytes(12*1024+333);
		let v = await testFS.versionedWriteBytes(fName, originalBytes);
		
		let { bytes, version } = await testFS.versionedReadBytes(fName, 12, 3456);
		cExpect(bytesEqual(bytes!, originalBytes.subarray(12, 3456))).toBe(true, 'should read from a proper file interior.');
		cExpect(version).toBe(v);
		
		({ bytes, version } = await testFS.versionedReadBytes(fName, 12*1024));
		cExpect(bytesEqual(bytes!, originalBytes.subarray(12*1024))).toBe(true, 'read should start from interior and go to file\'s end.');
		cExpect(version).toBe(v);
		
		({ bytes, version } = await testFS.versionedReadBytes(fName, 12*1024, 1024*1024));
		cExpect(bytesEqual(bytes!, originalBytes.subarray(12*1024))).toBe(true, 'when end parameter is greater than file size, bytes up to files end must be read.');
		cExpect(version).toBe(v);
		
		({ bytes, version } = await testFS.versionedReadBytes(fName, undefined, 123));
		cExpect(bytesEqual(bytes!, originalBytes)).toBe(true, 'when start parameter is not given, end should also be ignored');
		cExpect(version).toBe(v);
		
		({ bytes, version } = await testFS.versionedReadBytes(fName, 1024*1024, 1024*1024+4));
		cExpect(typeof bytes).toBe('undefined', 'when start is greater than file size, undefined must be returned');
		cExpect(version).toBe(v);
		
		({ bytes, version } = await testFS.versionedReadBytes(fName, 1024*1024));
		cExpect(typeof bytes).toBe('undefined', 'when start is greater than file size, undefined must be returned');
		cExpect(version).toBe(v);

		await testFS.versionedReadBytes(fName, -1).then(
			() => cFail('negative parameters should cause throwing up'),
			(err) => {});

		await testFS.versionedReadBytes(fName, 1, -2).then(
			() => cFail('negative parameters should cause throwing up'),
			(err) => {});
		
		({ bytes, version } = await testFS.versionedReadBytes(fName, 1234, 100));
		cExpect(typeof bytes).toBe('undefined', 'when end is smaller than start , undefined must be returned');
		cExpect(version).toBe(v);
				
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 14;
specs.its.push(it);

Object.freeze(exports);