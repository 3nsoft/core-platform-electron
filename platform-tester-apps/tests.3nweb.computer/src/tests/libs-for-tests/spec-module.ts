/*
 Copyright (C) 2016, 2018, 2020 - 2021 3NSoft Inc.
 
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

import { itCond, xitCond } from './jasmine-utils.js';

export interface SpecIt<S> {
	expectation: string;
	disableIn?: DisableFlag|DisableFlag[];
	notIncludedIn?: DisableFlag|DisableFlag[];
	func?: (setup: S) => Promise<void>;
	timeout?: number;
}

export type DisableFlag = 'device-fs' | 'win-local-fs' | 'big-msg-allowance';

export interface SpecDescribe {
	description: string;
	its: SpecIt<any>[];
	focused?: boolean;
}

function specFuncFor(
	it: SpecIt<any>, offFlags: DisableFlag[]|undefined
): (typeof xitCond)|(typeof itCond)|undefined {
	if (offFlags) {
		if (it.notIncludedIn) {
			if (Array.isArray(it.notIncludedIn)) {
				for (const flag of it.notIncludedIn) {
					if (offFlags.includes(flag)) { return; }
				}
			} else {
				if (offFlags.includes(it.notIncludedIn)) { return; }
			}
		}
		if (it.disableIn) {
			if (Array.isArray(it.disableIn)) {
				for (const flag of it.disableIn) {
					if (offFlags.includes(flag)) { return xitCond; }
				}
			} else {
				if (offFlags.includes(it.disableIn)) { return xitCond; }
			}
		}
	}
	return itCond;
}

export function loadSpecs<S extends { isUp: boolean }>(
	setup: S|undefined, specs: SpecDescribe[], offFlags?: DisableFlag[]
): void {
	specs.forEach((d) => {
		const describeFn = (d.focused ? fdescribe : describe);
		describeFn(d.description, () => {
			d.its.forEach(it => {
				const spec = specFuncFor(it, offFlags);
				if (!spec) { return; }
				spec(it.expectation, async function() {
					if (!it.func) { return; }
					await it.func(setup!);
				}, it.timeout);
			});
		});
	});
}
