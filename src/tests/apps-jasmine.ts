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

// NOTE: due to bad definition file, typescript below is not 100% type-strict.

import { stringifyErr } from '../lib-common/exceptions/error';

function injectIntoGlobal(mod: any): void {
	for (const field of Object.keys(mod)) {
		global[field] = mod[field];
	}
}

import * as asyncJasmine from './libs-for-tests/async-jasmine';
injectIntoGlobal(asyncJasmine);

import { setupWithUsers } from './libs-for-tests/setups';
injectIntoGlobal({ setupWithUsers });

import { exec, execExpects } from './libs-for-tests/remote-js-utils';
injectIntoGlobal({ exec, execExpects });

let spec_dir: string;
let spec_files: string[] = [];

const specArgs = process.argv.slice(2);
if (specArgs.length === 0) {
	console.log(`Directory with test specs is not given.`);
	process.exit(1);
	throw `Directory with test specs is not given.`;	// to please compiler
} else if (specArgs.length === 1) {
	spec_dir = specArgs[0];
	spec_files = [ '*.js' ];
} else {
	spec_dir = specArgs[0];
	spec_files = specArgs.slice(1);
}

const jas = new (require('jasmine'))();

jas.loadConfig({
	spec_dir,
	spec_files
});

jas.configureDefaultReporter({
	showColors: true
});

const unhandledRejections = new WeakMap();
process.on('unhandledRejection', (reason, p) => {
	unhandledRejections.set(p, reason);
	console.error(`
Got an unhandled rejection:
${stringifyErr(reason)}`);
});
process.on('rejectionHandled', (p) => {
	const reason = unhandledRejections.get(p);
	console.error(`
Handling previously unhandled rejection:
${stringifyErr(reason)}`);
	unhandledRejections.delete(p);
});

jas.execute();
