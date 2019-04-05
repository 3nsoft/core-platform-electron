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

type FileException = web3n.files.FileException;
declare var testFS: web3n.files.WritableFS;

export let specs: SpecDescribe = {
	description: '.readTxtFile',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent file' };
it.func = async function() {
	let fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	await testFS.readTxtFile(fName)
	.then(() => {
		fail('reading text must fail, when file does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBe(true);
		if (!err.notFound) { throw err; }
	});
};
it.numOfExpects = 2;
specs.its.push(it);

it = { expectation: 'reads json file' };
it.func = async function() {
	let original = 'Should I be at BlackHat conference or working?';
	let fName = 'file1';
	let v1 = await testFS.v!.writeTxtFile(fName, original);
	let { txt, version } = await testFS.v!.readTxtFile(fName);
	expect(txt).toBe(original, 'file read should produce original text');
	expect(version).toBe(v1, 'file version at reading should exactly the same as that on respective write');
	
	let v2 = await testFS.v!.writeBytes(fName, new Uint8Array(0));
	expect(v2).toBeGreaterThan(v1);
	({ txt, version } = await testFS.v!.readTxtFile(fName));
	expect(txt).toBe('', 'empty file should be read as an empty string');
	expect(version).toBe(v2, 'file version at reading should exactly the same as that on respective write');
};
it.numOfExpects = 5;
specs.its.push(it);

Object.freeze(exports);