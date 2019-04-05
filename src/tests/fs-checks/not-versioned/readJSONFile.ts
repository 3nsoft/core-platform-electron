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
import { deepEqual as jsonDeepEqual } from '../../libs-for-tests/json-equal';

type FileException = web3n.files.FileException;
declare var testFS: web3n.files.WritableFS;
let deepEqual = jsonDeepEqual;

export let specs: SpecDescribe = {
	description: '.readJSONFile',
	its: []
};

let it: SpecIt = { expectation: 'fails to read non-existent file' };
it.func = async function() {
	let fName = 'unknown-file';
	expect(await testFS.checkFilePresence(fName)).toBe(false);
	await testFS.readJSONFile(fName)
	.then(() => {
		fail('reading json must fail, when file does not exist');
	}, (err: FileException) => {
		expect(err.notFound).toBe(true);
		if (!err.notFound) { throw err; }
	});
};
it.numOfExpects = 2;
specs.its.push(it);

it = { expectation: 'reads json file' };
it.func = async function() {
	let original = { a: 'foo', b: true, 'df-df': 23};
	let fName = 'file1';
	await testFS.writeJSONFile(fName, original);
	let json = await testFS.readJSONFile(fName);
	expect(deepEqual(json, original)).toBe(true, 'file read should produce original json');
	
	fName = 'file2';
	await testFS.writeBytes(fName, new Uint8Array(0));
	await testFS.readJSONFile(fName)
	.then(() => {
		fail('reading empty file should fail, as empty is not valid json');
	}, (exc) => {
		expect(exc).toBeTruthy();
	});
};
it.numOfExpects = 2;
specs.its.push(it);

Object.freeze(exports);