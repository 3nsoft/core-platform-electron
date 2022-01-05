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
	description: 'mkdir implementation',
	its: []
};

let it: SpecIt = {
	expectation: `makes directory`,
	funcArgs: [ 'c', 'mntPoint' ]
};
it.func = async function(c: () => SpectronClient, mntPoint: () => string) {

	const folder = 'new folder';
	const folderPath = `${mntPoint()}/${folder}`;
	let folderFound = await exec(c(), async function(folder: string) {
		return await mntFS.checkFolderPresence(folder, false);
	}, folder);
	expect(folderFound).toBe(false);
	await nodeFS.stat(folderPath)
	.then(
		() => fail(`folder shouldn't be present`),
		(err: FileException) => expect(err.notFound).toBe(true));

	await nodeFS.mkdir(folderPath);

	const stats = await nodeFS.stat(folderPath);
	expect(stats.isDirectory()).toBe(true);
	folderFound = await exec(c(), async function(folderPath: string) {
		return await mntFS.checkFolderPresence(folderPath, false);
	}, folder);
	expect(folderFound).toBe(true);
};
specs.its.push(it);

