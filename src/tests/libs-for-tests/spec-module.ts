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
import { SpectronClient } from 'spectron';

export interface SpecIt {
	expectation: string;
	disableIn?: string;
	func?: (...args: any[]) => void;
	funcArgs?: string[];
	numOfExpects?: number;
	timeout?: number;
}

export interface SpecDescribe {
	description: string;
	its: SpecIt[];
	focused?: boolean;
}

function readSpecs(folderWithModules: string): SpecDescribe[] {
	const specs: SpecDescribe[] = [];
	const modulesWithSpecs = readdirSync(folderWithModules);
	for (const fName of modulesWithSpecs) {
		const s: SpecDescribe = require(resolve(folderWithModules, fName)).specs;
		if (s) {
			specs.push(s);
		} else {
			console.error(`Module ${fName} is not exposing specs objects with tests`);
		}
	}
	return specs;
}

function collectAllExpectations(): void {};

export function fsSpecsForWebDrvCtx(
		c: () => SpectronClient,
		folderWithModules: string,
		disableFlag?: string): void {
	const specs = readSpecs(folderWithModules);
	specs.forEach((d) => {
		const describeFn = (d.focused ? fdescribe : describe);
		describeFn(d.description, () => {
			d.its.forEach((it) => {
				const spec = ((!it.func || (disableFlag && it.disableIn &&
					it.disableIn.match(disableFlag))) ? xitAsync : itAsync);
				spec(it.expectation, async function() {
					if (!it.func) { return; }
					if (it.timeout) {
						c().timeouts('script', it.timeout);
					}
					c().execute(function() { collectAllExpectations(); });
					const exec = c().executeAsync(it.func);
					if (it.timeout) {
						c().timeouts('script', 5000);
					}
					const exps = (await exec).value;
					checkRemoteExpectations(exps, it.numOfExpects);
				}, it.timeout);
			});
		});
	});
}

export function fsSpecsForCurrentCtx(
		folderWithModules: string,
		disableFlag?: string): void {
	const specs = readSpecs(folderWithModules);
	specs.forEach((d) => {
		const describeFn = (d.focused ? fdescribe : describe);
		describeFn(d.description, () => {
			d.its.forEach((it) => {
				const spec = ((!it.func || (disableFlag && it.disableIn &&
					it.disableIn.match(disableFlag))) ? xitAsync : itAsync);
				spec(it.expectation, async function() {
					if (!it.func) { return; }
					const done = () => {};
					await it.func(done);
				}, it.timeout);
			});
		});
	});
}

export function specsWithArgs(folderWithModules: string,
		args: { [argName: string]: () => any; }): void {
	const specs = readSpecs(folderWithModules);
	specs.forEach((d) => {
		const describeFn = (d.focused ? fdescribe : describe);
		describeFn(d.description, () => {
			d.its.forEach((it) => {
				const spec = (it.func  ? itAsync : xitAsync);
				spec(it.expectation, async function() {
					if (!it.func) { return; }
					if (it.funcArgs) {
						const funcArgs: (() => any)[] = [];
						for (const argName of it.funcArgs) {
							funcArgs.push(args[argName]);
						}
						await it.func(...funcArgs);
					} else {
						await it.func();
					}
				}, it.timeout);
			});
		});
	});
}

Object.freeze(exports);