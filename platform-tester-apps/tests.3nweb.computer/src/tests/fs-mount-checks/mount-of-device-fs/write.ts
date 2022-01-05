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

declare var mountPoint: string;
declare var fs: web3n.files.WritableFS;

export const specs: SpecDescribe = {
	description: 'implements write operation',
	its: []
};

let it: SpecIt = { expectation: `writes an empty file` };
it.func = async function() {

	const fName = 'empty-file';
	const pathInOS = `${mountPoint}/${fName}`;
	
	let fd = await nodeFS.open(pathInOS, 'w');
	await nodeFS.close(fd);

	let stat = await fs.stat(fName);
	expect(stat.size).toBe(0);

};
specs.its.push(it);

it = { expectation: `writes file in chunks` };
it.func = async function() {

	// 1) write into fresh file
	const fName = 'long-file';
	const pathInOS = `${mountPoint}/${fName}`;
	let fileContent = await stringOfB64Chars(3000);
	
	let fd = await nodeFS.open(pathInOS, 'wx');
	const delta = 100;
	for (let pos=0; pos<fileContent.length; pos+=delta) {
		const buf = Buffer.from(fileContent.substring(pos, pos+delta), 'utf8');
		await nodeFS.write(fd, pos, buf);
	}
	await nodeFS.close(fd);

	let stat = await nodeFS.stat(pathInOS);
	expect(stat.size).toBe(fileContent.length);
	let readContent = await fs.readTxtFile(fName);
	expect(fileContent === readContent).toBe(true);

	// 2) write into existing file
	fileContent = await stringOfB64Chars(4000);
	fd = await nodeFS.open(pathInOS, 'w');
	for (let pos=0; pos<fileContent.length; pos+=delta) {
		const buf = Buffer.from(fileContent.substring(pos, pos+delta), 'utf8');
		await nodeFS.write(fd, pos, buf);
	}
	await nodeFS.close(fd);

	stat = await nodeFS.stat(pathInOS);
	expect(stat.size).toBe(fileContent.length);
	readContent = await fs.readTxtFile(fName);
	expect(fileContent === readContent).toBe(true);

};
specs.its.push(it);
