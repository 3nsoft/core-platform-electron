/*
 Copyright (C) 2018 3NSoft Inc.
 
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
import * as nodeFS from '../../../lib-common/async-fs-node';
import { stringOfB64Chars } from '../../../lib-common/random-node';
import { SpectronClient } from 'spectron';
import { exec } from '../../libs-for-tests/remote-js-utils';

declare var mntFS: web3n.files.WritableFS;

export const specs: SpecDescribe = {
	description: 'readdir implementation',
	its: []
};

let it: SpecIt = {
	expectation: `lists root`,
	funcArgs: [ 'c', 'mntPoint' ]
};
it.func = async function(c: () => SpectronClient, mntPoint: () => string) {

	const initLst = await nodeFS.readdir(mntPoint());
	expect(initLst.length).toBe(0);
	
	// add file in root
	const fName = 'test-file-1';
	const fileContent = await stringOfB64Chars(30);
	await exec(c(), async function(fName: string, fileContent: string) {
		await mntFS.writeTxtFile(
			fName, fileContent, { create:true, exclusive:true });
	}, fName, fileContent);

	const lst = await nodeFS.readdir(mntPoint());
	expect(lst.length).toBe(1);
	expect(lst).toContain(fName);

};
specs.its.push(it);

