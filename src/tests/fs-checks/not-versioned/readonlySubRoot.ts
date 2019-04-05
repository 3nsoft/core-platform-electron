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

type FileException = web3n.files.FileException;
declare var testFS: web3n.files.WritableFS;

export let specs: SpecDescribe = {
	description: '.readonlySubRoot',
	its: []
};

let it: SpecIt = { expectation: 'creates sub-root based on existing folder' };
it.func = async function() {
	let path = 'sub-root';
	await testFS.makeFolder(path);
	expect(await testFS.checkFolderPresence(path)).toBe(true);
	let subRoot = await testFS.readonlySubRoot(path);
	expect(subRoot).toBeTruthy();
	expect(subRoot.writable).toBe(false);
	expect(!!subRoot.v).toBe(!!testFS.v);
	const lst = await subRoot.listFolder('');
	expect(Array.isArray(lst)).toBe(true);
};
it.numOfExpects = 5;
specs.its.push(it);

it = { expectation: 'fails to create a sub-root, whenfolder is missing' };
it.func = async function() {
	let path = 'sub-root2';
	expect(await testFS.checkFolderPresence(path)).toBe(false);
	try {
		await testFS.readonlySubRoot(path);
		fail('making a readonly sub-root on a missing folder should fail')
	} catch (exc) {
		expect((exc as FileException).notFound).toBe(true);
		if (!exc.notFound) { throw exc; }
	}
};
it.numOfExpects = 2;
specs.its.push(it);

Object.freeze(exports);