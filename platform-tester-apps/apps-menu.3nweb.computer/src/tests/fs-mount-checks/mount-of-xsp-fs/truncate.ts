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
import { exec } from '../../libs-for-tests/remote-js-utils';
import { SpectronClient } from 'spectron';

declare var mntFS: web3n.files.WritableFS;

export const specs: SpecDescribe = {
	description: 'truncate implementation',
	its: []
};

let it: SpecIt = {
	expectation: `truncate file`,
	funcArgs: [ 'c', 'mntPoint' ]
};
it.func = async function(c: () => SpectronClient, mntPoint: () => string) {

	const file = 'file to truncate';
	const filePath = `${mntPoint()}/${file}`;

	await nodeFS.truncate(filePath, 500)
	.then(
		() => fail(`file shouldn't be present`),
		(err: FileException) => expect(err.notFound).toBe(true));

	async function checkSizeAndVersionOf(
		file: string, expectedSize: number, expectedVersion: number
	) {
		const { size, version } = await exec(c(), async function(file: string) {
			const { size, version } = await mntFS.stat(file);
			return { size, version };
		}, file);
		expect(size).toBe(expectedSize, `file size`);
		expect(version).toBe(expectedVersion, `file version`);
	}

	let fileVersion = await exec(c(), async function(file: string) {
		return await mntFS.v!.writeTxtFile(
			file, '', { create:true, exclusive:true });
	}, file);
	await checkSizeAndVersionOf(file, 0, fileVersion);

	await nodeFS.truncate(filePath, 500);
	fileVersion += 1;

	checkSizeAndVersionOf(file, 500, fileVersion);

	await nodeFS.truncate(filePath, 100);
	fileVersion += 1;

	await checkSizeAndVersionOf(file, 100, fileVersion);
};
specs.its.push(it);

