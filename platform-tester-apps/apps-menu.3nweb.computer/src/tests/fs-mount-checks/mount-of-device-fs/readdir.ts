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

declare var mountPoint: string;
declare var fs: web3n.files.WritableFS;

export const specs: SpecDescribe = {
	description: 'readdir implementation',
	its: []
};

let it: SpecIt = { expectation: `lists root` };
it.func = async function() {

	const initLst = await nodeFS.readdir(mountPoint);
	expect(initLst.length).toBe(0);
	
	const fName = 'test-file-1';
	const fileContent = await stringOfB64Chars(30);
	await fs.writeTxtFile(fName, fileContent, { create:true, exclusive:true });

	const lst = await nodeFS.readdir(mountPoint);
	expect(lst.length).toBe(1);
	expect(lst).toContain(fName);

};
specs.its.push(it);

