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
	description: '.getByteSink',
	its: []
};

let it: SpecIt = { expectation: 'if not allowed to create, fails for missing file' };
it.func = async function(done: Function) {
	try {
		await testFS.getByteSink('non-existing-file', false)
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

it = { expectation: 'creates file in existing folder' };
it.func = async function(done: Function) {
	try {
		let path = 'file1';
		let bytes = testRandomBytes(2*1024);
		cExpect(await testFS.checkFilePresence(path)).toBe(false);
		let sink = await testFS.getByteSink(path);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
		cExpect(await sink.getSize()).toBe(0);
		for (let pointer=0; pointer < bytes.length; pointer+=250) {
			let chunkEnd = pointer + 250;
			await sink.write(bytes.subarray(pointer, chunkEnd));
			cExpect(await sink.getSize()).toBe(
				Math.min(chunkEnd, bytes.length));
		}
		cExpect(await sink.getSize()).toBe(bytes.length);
		await sink.write(null);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
specs.its.push(it);

it = { expectation: 'creates parent folder(s) on the way' };
it.func = async function(done: Function) {
	try {
		let fName = 'file2';
		let grParent = 'grand-parent';
		let parent2 = 'grand-parent/parent2';
		let path = `${parent2}/${fName}`;
		cExpect(await testFS.checkFolderPresence(grParent)).toBe(false);
		cExpect(await testFS.checkFolderPresence(parent2)).toBe(false);
		cExpect(await testFS.checkFolderPresence(path)).toBe(false);
		let sink = await testFS.getByteSink(path);
		cExpect(await testFS.checkFolderPresence(grParent)).toBe(true);
		cExpect(await testFS.checkFolderPresence(parent2)).toBe(true);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 6;
specs.its.push(it);

it = { expectation: 'opens existing file',
	// For now Storage FS is not producing seek-able sinks,
	// thus, disabling spec till the moment it does.
	disableIn: 'storage-fs' };
it.func = async function(done: Function) {
	try {
		let path = 'file2';
		let bytes = testRandomBytes(2*1024);
		let originalSize = bytes.length;
		await testFS.writeBytes(path, bytes);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
		let sink = await testFS.getByteSink(path);
		cExpect(await sink.getSize()).toBe(originalSize, 'Existing file should be opened as is');
		cExpect(await sink.getPosition()).toBe(0);
		await sink.seek(originalSize);
		cExpect(await sink.getPosition()).toBe(originalSize);
		await sink.write(bytes);
		cExpect(await sink.getSize()).toBe(originalSize + bytes.length);
		await sink.write(null);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
specs.its.push(it);

Object.freeze(exports);