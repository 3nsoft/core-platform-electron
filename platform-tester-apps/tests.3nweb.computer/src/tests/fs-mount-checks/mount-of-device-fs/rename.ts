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

type FileException = web3n.files.FileException;
declare var mountPoint: string;
declare var fs: web3n.files.WritableFS;

export const specs: SpecDescribe = {
	description: 'rename implementation',
	its: []
};

let it: SpecIt = { expectation: `can rename path` };
it.func = async function() {

	const initFName = `init-file`;
	const fileContent = await stringOfB64Chars(30);
	const folder = 'folder';
	await fs.writeTxtFile(
		initFName, fileContent, { create:true, exclusive:true });
	await fs.makeFolder(folder, true);

	const initPath = `${mountPoint}/${initFName}`;
	const newPath = `${mountPoint}/${folder}/moved-file`;

	await nodeFS.rename(initPath, newPath);

	expect((await nodeFS.readFile(newPath)).toString()).toBe(fileContent);
	await nodeFS.stat(initPath)
	.then(st => fail())
	.catch((exc: FileException) => {
		if (!exc.notFound) { throw exc; }
	});

};
specs.its.push(it);

