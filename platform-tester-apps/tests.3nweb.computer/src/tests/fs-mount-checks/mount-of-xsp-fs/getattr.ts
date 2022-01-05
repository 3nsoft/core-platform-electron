/*
 Copyright (C) 2018, 2021 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { SpecDescribe, SpecIt } from '../../libs-for-tests/spec-module';
// import * as nodeFS from '../../../lib-common/async-fs-node';
// import { SpectronClient } from 'spectron';

declare var mntFS: web3n.files.WritableFS;

export const specs: SpecDescribe = {
	description: 'getattr implementation',
	its: []
};

let it: SpecIt = {
	expectation: `stats root`,
	funcArgs: [ 'c', 'mntPoint' ]
};
it.func = async function(c: () => SpectronClient, mntPoint: () => string) {

	const stats = await nodeFS.stat(mntPoint());
	expect(stats.isDirectory()).toBe(true);

};
specs.its.push(it);

