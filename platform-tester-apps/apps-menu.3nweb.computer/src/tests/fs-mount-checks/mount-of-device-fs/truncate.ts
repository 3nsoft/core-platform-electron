/*
 Copyright (C) 2020 3NSoft Inc.
 
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
import { FileException } from '../../../lib-common/async-fs-node';

declare var mountPoint: string;
declare var fs: web3n.files.WritableFS;

export const specs: SpecDescribe = {
	description: 'truncate implementation',
	its: []
};

let it: SpecIt = {
	expectation: `truncate file`,
	funcArgs: [ 'c', 'mntPoint' ]
};
it.func = async function() {

	const file = 'file to truncate';
	const filePath = `${mountPoint}/${file}`;

	await nodeFS.truncate(filePath, 500)
	.then(
		() => fail(`file shouldn't be present`),
		(err: FileException) => expect(err.notFound).toBe(true));

	async function checkSizeOf(file: string, expectedSize: number) {
		const size = (await fs.stat(file)).size;
		expect(size).toBe(expectedSize, `file size of "${file}"`);
	}

	await fs.writeTxtFile(file, '', { create:true, exclusive:true });
	await checkSizeOf(file, 0);

	await nodeFS.truncate(filePath, 500);
	await checkSizeOf(file, 500);

	await nodeFS.truncate(filePath, 100);
	await checkSizeOf(file, 100);
};
specs.its.push(it);

