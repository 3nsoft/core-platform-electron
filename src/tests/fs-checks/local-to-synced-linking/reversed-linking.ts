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

declare var syncedTestFS: web3n.files.WritableFS;
declare var localTestFS: web3n.files.WritableFS;

export let specs: SpecDescribe = {
	description: '.link should fail to link from synced into local storage,',
	its: []
};

let it: SpecIt = { expectation: 'linking file' };
it.func = async function() {
	let original = 'Should I be at BlackHat conference or working?';
	let fName = 'file1';
	await localTestFS.writeTxtFile(fName, original, true);
	let file = await localTestFS.readonlyFile(fName);

	let linkPath = 'link1';
	await syncedTestFS.link(linkPath, file).catch((err) => {
		expect(typeof err).toBe('object');
	});
};
it.numOfExpects = 1;
specs.its.push(it);

it = { expectation: 'linking folder' };
it.func = async function() {
	let original = 'Should I be at BlackHat conference or working?';
	let folderName = 'folder1';
	let fName = 'file1';
	await localTestFS.writeTxtFile(`${folderName}/${fName}`, original, true);
	let folder = await localTestFS.writableSubRoot(folderName);

	let linkPath = 'link1';
	await syncedTestFS.link(linkPath, folder).catch((err) => {
		expect(typeof err).toBe('object');
	});
};
it.numOfExpects = 1;
specs.its.push(it);
