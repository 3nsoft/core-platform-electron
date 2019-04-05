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

type FileException = web3n.files.FileException;
declare var testFS: web3n.files.WritableFS;

export let specs: SpecDescribe = {
	description: '.readLink',
	its: []
};

let it: SpecIt = { expectation: 'cannot read non-existing link' };
it.func = async function() {
	let fName = 'non-existing-link';
	try {
		await testFS.readLink(fName)
		fail('reading non-existing link must fail');
	} catch (exc) {
		expect((exc as FileException).notFound).toBe(true);
		if (!exc.notFound) { throw exc; }
	}
};
it.numOfExpects = 1;
specs.its.push(it);
