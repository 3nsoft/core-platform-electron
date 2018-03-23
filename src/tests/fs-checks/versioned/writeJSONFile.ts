/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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
let cExpect = expect;
let cFail = fail;
function collectAllExpectations(): void {};

export let specs: SpecDescribe = {
	description: '.writeJSONFile',
	its: []
};

let it: SpecIt = { expectation: 'if not allowed to create, fails for missing file' };
it.func = async function(done: Function) {
	try {
		let json = { a: 1, b: 2 };
		await testFS.writeJSONFile('non-existing-file', json, false)
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
		let initJson = { a: 1, b: 2 };
		cExpect(await testFS.checkFilePresence(path)).toBe(false);
		let v = await testFS.v!.writeJSONFile(path, initJson);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
		let { json, version } = await testFS.v!.readJSONFile(path);
		cExpect(deepEqual(initJson, json)).toBe(true);
		cExpect(version).toBe(v);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 4;
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
		let initJson = { a: 'foo', b: true, 'df-df': 23};
		let v = await testFS.v!.writeJSONFile(path, initJson);
		cExpect(await testFS.checkFolderPresence(grParent)).toBe(true);
		cExpect(await testFS.checkFolderPresence(parent2)).toBe(true);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
		let { json, version } = await testFS.v!.readJSONFile(path);
		cExpect(deepEqual(initJson, json)).toBe(true);
		cExpect(version).toBe(v);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 8;
specs.its.push(it);

it = { expectation: 'over-writes existing file with a non-exclusive call' };
it.func = async function(done: Function) {
	try {
		let path = 'file3';
		// setup initial file
		let initJson = { a: 'foo', b: true, 'df-df': 23};
		let v1 = await testFS.v!.writeJSONFile(path, initJson);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
		let { json, version } = await testFS.v!.readJSONFile(path);
		cExpect(deepEqual(initJson, json)).toBe(true);
		cExpect(version).toBe(v1);
		// write new file content
		let newJson = null;
		let v2 = await testFS.v!.writeJSONFile(path, newJson);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
		({ json, version } = await testFS.v!.readJSONFile(path));
		cExpect(deepEqual(newJson, json)).toBe(true);
		cExpect(version).toBe(v2);
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 6;
specs.its.push(it);

it = { expectation: 'exclusive-create write throws when file already exists' };
it.func = async function(done: Function) {
	try {
		let path = 'file4';
		// setup initial file
		let initJson = { a: 'foo', b: true, 'df-df': 23};
		let v = await testFS.v!.writeJSONFile(path, initJson);
		cExpect(await testFS.checkFilePresence(path)).toBe(true);
		// try an exclusive write
		let newJson = null;
		await testFS.writeJSONFile(path, newJson, true, true)
		.then(() => {
			cFail('exclusive-create write operation must fail, when file exists.');
		}, (exc: FileException) => {
			cExpect(exc.alreadyExists).toBe(true);
		});
		let { json, version } = await testFS.v!.readJSONFile(path);
		cExpect(deepEqual(initJson, json)).toBe(true, 'initial file content stays intact');
		cExpect(version).toBe(v, 'initial file version stays intact');
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 4;
specs.its.push(it);

Object.freeze(exports);