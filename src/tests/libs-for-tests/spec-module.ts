/*
 Copyright (C) 2016 3NSoft Inc.
 
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

import { itAsync, xitAsync } from './async-jasmine';
import { checkRemoteExpectations } from './setups';
import { resolve } from 'path';
import { readdirSync } from 'fs';

export interface SpecIt {
	expectation: string;
	disableIn?: string;
	func?: Function;
	funcArgs?: string[];
	numOfExpects?: number;
}

export interface SpecDescribe {
	description: string;
	its: SpecIt[];
	focused?: boolean;
}

function readSpecs(folderWithModules: string): SpecDescribe[] {
	let specs: SpecDescribe[] = [];
	let modulesWithSpecs = readdirSync(folderWithModules);
	for (let fName of modulesWithSpecs) {
		let s: SpecDescribe = require(resolve(folderWithModules, fName)).specs;
		if (s) {
			specs.push(s);
		} else {
			console.error(`Module ${fName} is not exposing specs objects with tests`);
		}
	}
	return specs;
}

export function fsSpecsForWebDrvCtx(
		c: () => WebdriverIO.Client<any>,
		folderWithModules: string,
		disableFlag?: string): void {
	let specs = readSpecs(folderWithModules);
	specs.forEach((d) => {
		let describeFn = (d.focused ? fdescribe : describe);
		describeFn(d.description, () => {
			d.its.forEach((it) => {
				let spec = ((!it.func || (disableFlag && it.disableIn &&
					it.disableIn.match(disableFlag))) ? xitAsync : itAsync);
				spec(it.expectation, async function() {
					if (!it.func) { return; }
					let exec = c().executeAsync(it.func);
					let exps = (await exec).value;
					checkRemoteExpectations(exps, it.numOfExpects);
				});
			});
		});
	});
}

export function fsSpecsForCurrentCtx(
		folderWithModules: string,
		disableFlag?: string): void {
	let specs = readSpecs(folderWithModules);
	specs.forEach((d) => {
		let describeFn = (d.focused ? fdescribe : describe);
		describeFn(d.description, () => {
			d.its.forEach((it) => {
				let spec = ((!it.func || (disableFlag && it.disableIn &&
					it.disableIn.match(disableFlag))) ? xitAsync : itAsync);
				spec(it.expectation, async function() {
					if (!it.func) { return; }
					let done = () => {};
					await it.func(done);
				});
			});
		});
	});
}

export function specsWithArgs(folderWithModules: string,
		args: { [argName: string]: () => any; }): void {
	let specs = readSpecs(folderWithModules);
	specs.forEach((d) => {
		let describeFn = (d.focused ? fdescribe : describe);
		describeFn(d.description, () => {
			d.its.forEach((it) => {
				let spec = (it.func  ? itAsync : xitAsync);
				spec(it.expectation, async function() {
					if (!it.func) { return; }
					if (it.funcArgs) {
						let funcArgs: (() => any)[] = [];
						for (let argName of it.funcArgs) {
							funcArgs.push(args[argName]);
						}
						await it.func(...funcArgs);
					} else {
						await it.func();
					}
				});
			});
		});
	});
}

Object.freeze(exports);