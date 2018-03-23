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
import { bytesSync as randomBytes } from '../../../lib-common/random-node';
import { bytesEqual as byteArraysEqual }
	from '../../libs-for-tests/bytes-equal';

type FileException = web3n.files.FileException;
declare var testFS: web3n.files.WritableFS;
let testRandomBytes = randomBytes;
let bytesEqual = byteArraysEqual;
let cExpect = expect;
let cFail = fail;
function collectAllExpectations(): void {};

export let specs: SpecDescribe = {
	description: '.readBytes',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent file' };
it.func = async function(done: Function) {
	try {
		let fName = 'unknown-file';
		cExpect(await testFS.checkFilePresence(fName)).toBe(false);
		await testFS.readBytes(fName)
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
		await testFS.writeBytes(fName, originalBytes);
		let bytes = await testFS.readBytes(fName);
		cExpect(bytesEqual(bytes!, originalBytes)).toBe(true, 'file read should produce array with all bytes');
		
		fName = 'file2';
		await testFS.writeBytes(fName, new Uint8Array(0));
		bytes = await testFS.readBytes(fName);
		cExpect(typeof bytes).toBe('undefined', 'reading empty file should produce undefined');
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 2;
specs.its.push(it);

it = { expectation: 'reads part of the file' };
it.func = async function(done: Function) {
	try {
		let fName = 'file3';
		let originalBytes = testRandomBytes(12*1024+333);
		await testFS.writeBytes(fName, originalBytes);
		
		let bytes = await testFS.readBytes(fName, 12, 3456);
		cExpect(bytesEqual(bytes!, originalBytes.subarray(12, 3456))).toBe(true, 'should read from a proper file interior.');
		
		bytes = await testFS.readBytes(fName, 12*1024);
		cExpect(bytesEqual(bytes!, originalBytes.subarray(12*1024))).toBe(true, 'read should start from interior and go to file\'s end.');
		
		bytes = await testFS.readBytes(fName, 12*1024, 1024*1024);
		cExpect(bytesEqual(bytes!, originalBytes.subarray(12*1024))).toBe(true, 'when end parameter is greater than file size, bytes up to files end must be read.');
		
		bytes = await testFS.readBytes(fName, undefined, 123);
		cExpect(bytesEqual(bytes!, originalBytes)).toBe(true, 'when start parameter is not given, end should also be ignored');
		
		bytes = await testFS.readBytes(fName, 1024*1024, 1024*1024+4);
		cExpect(typeof bytes).toBe('undefined', 'when start is greater than file size, undefined must be returned');
		
		bytes = await testFS.readBytes(fName, 1024*1024);
		cExpect(typeof bytes).toBe('undefined', 'when start is greater than file size, undefined must be returned');

		await testFS.readBytes(fName, -1).then(
			() => cFail('negative parameters should cause throwing up'),
			(err) => {});

		await testFS.readBytes(fName, 1, -2).then(
			() => cFail('negative parameters should cause throwing up'),
			(err) => {});
		
		bytes = await testFS.readBytes(fName, 1234, 100);
		cExpect(typeof bytes).toBe('undefined', 'when end is smaller than start , undefined must be returned');
				
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 7;
specs.its.push(it);

Object.freeze(exports);