/*
 Copyright (C) 2018, 2020 3NSoft Inc.
 
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
import { exec } from '../../libs-for-tests/setups';

declare var mntFS: web3n.files.WritableFS;

export const specs: SpecDescribe = {
	description: 'implements write operation',
	its: []
};

let it: SpecIt = {
	expectation: `writes file in chunks`,
	funcArgs: [ 'c', 'mntPoint' ]
};
it.func = async function(c: () => SpectronClient, mntPoint: () => string) {

	// 1) write into fresh file
	const fName = 'long-file';
	const pathInOS = `${mntPoint()}/${fName}`;
	let fileContent = await stringOfB64Chars(3000);
	
	const delta = 100;
	let fd = await nodeFS.open(pathInOS, 'wx');
	try {
		for (let pos=0; pos<fileContent.length; pos+=delta) {
			const buf = Buffer.from(fileContent.substring(pos, pos+delta), 'utf8');
			await nodeFS.write(fd, pos, buf);
		}
	} finally {
		await nodeFS.close(fd);
	}

	let stat = await nodeFS.stat(pathInOS);
	expect(stat.size).toBe(fileContent.length);
	let readContent = await exec(c(), function(fName: string) {
		return mntFS.readTxtFile(fName);
	}, fName);
	expect(fileContent === readContent).toBe(true);

	// 2) truncate and write into existing file
	fileContent = await stringOfB64Chars(4000);
	fd = await nodeFS.open(pathInOS, 'w');
	try {
		for (let pos=0; pos<fileContent.length; pos+=delta) {
			const buf = Buffer.from(fileContent.substring(pos, pos+delta), 'utf8');
			await nodeFS.write(fd, pos, buf);
		}
	} finally {
		await nodeFS.close(fd);
	}

	stat = await nodeFS.stat(pathInOS);
	expect(stat.size).toBe(fileContent.length);
	readContent = readContent = await exec(c(), function(fName: string) {
		return mntFS.readTxtFile(fName);
	}, fName);
	expect(fileContent === readContent).toBe(true);

	// 3) write into existing file without truncating
	fileContent = await stringOfB64Chars(4000);
	fd = await nodeFS.open(pathInOS, 'w+');
	try {
		for (let pos=0; pos<fileContent.length; pos+=delta) {
			const buf = Buffer.from(fileContent.substring(pos, pos+delta), 'utf8');
			await nodeFS.write(fd, pos, buf);
		}
	} finally {
		await nodeFS.close(fd);
	}

};
specs.its.push(it);

