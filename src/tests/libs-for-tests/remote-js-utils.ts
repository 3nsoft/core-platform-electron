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

import { SpectronClient } from 'spectron';
import { ErrorWithCause } from '../../lib-common/exceptions/error';

type CollectedExpectations = (any[] | { isFail: boolean; e: string; })[];

/**
 * @param exps is an array of jasmine expectations from client side, assembled
 * by inject in setRemoteJasmineInClient(app) function; 
 */
export function checkRemoteExpectations(exps: CollectedExpectations,
		numOfExpectations?: number): void {
	for (let exp of exps) {
		if (Array.isArray(exp)) {
			let actual = exp.shift();
			let m = expect(actual);
			if (exp[0] === 'not') {
				m = m.not;
				exp.shift();
			}
			let methodName = exp.shift();
			if (!methodName) { throw new Error(
				'Expect clause does not have following matching clause.'); }
			let method = (<Function> m[methodName]);
			if (!method) { throw new Error(
				`Cannot find method ${methodName} in a jasmine match.`); }
			method.apply(m, exp);
		} else {
			fail(exp.e);
		}
	}
	if (typeof numOfExpectations === 'number') {
		expect(exps.length).toBe(numOfExpectations, 'total number of reported checks from a remote side');
	}
}

export async function setRemoteJasmineInClient(c: SpectronClient):
		Promise<void> {
	await c.execute(function() {

		let collectedExpectations: CollectedExpectations = [];
		
		(<any> window).collectAllExpectations = () => {
			let exps = collectedExpectations;
			collectedExpectations = [];
			return exps;
		};

		(<any> window).cFail = (e?: any) => {
			collectedExpectations.push({
				isFail: true,
				e: e.stack ? e.stack : JSON.stringify(e, null, '  ')
			});
		};

		(<any> window).cExpect = <T>(actual: any): jasmine.Matchers<T> => {
		
			let expectation: any[] = [ actual ];
			collectedExpectations.push(expectation);

			let m = {

				toBe(expected: any, expectationFailOutput?: any) {
					expectation.push( 'toBe', expected, expectationFailOutput );
				},

				toEqual(expected: any, expectationFailOutput?: any) {
					expectation.push( 'toEqual', expected, expectationFailOutput );
				},
				
				toMatch(expected: string | RegExp, expectationFailOutput?: any) {
					expectation.push( 'toMatch', expected, expectationFailOutput );
				},
				
				toBeDefined(expectationFailOutput?: any) {
					expectation.push( 'toBeDefined', expectationFailOutput );
				},
				
				toBeUndefined(expectationFailOutput?: any) {
					expectation.push( 'toBeUndefined', expectationFailOutput );
				},
				
				toBeNull(expectationFailOutput?: any) {
					expectation.push( 'toBeNull', expectationFailOutput );
				},
				
				toBeNaN() {
					expectation.push( 'toBeNaN' );
				},
				
				toBeTruthy(expectationFailOutput?: any) {
					expectation.push( 'toBeTruthy', expectationFailOutput );
				},
				
				toBeFalsy(expectationFailOutput?: any) {
					expectation.push( 'toBeFalsy', expectationFailOutput );
				},
				
				toContain(expected: any, expectationFailOutput?: any) {
					expectation.push( 'toContain', expected, expectationFailOutput );
				},
				
				toBeLessThan(expected: number, expectationFailOutput?: any) {
					expectation.push( 'toBeLessThan', expected, expectationFailOutput );
				},
				
				toBeGreaterThan(expected: number, expectationFailOutput?: any) {
					expectation.push( 'toBeGreaterThan', expected, expectationFailOutput );
				},
				
				toBeCloseTo(expected: number, precision?: any, expectationFailOutput?: any) {
					expectation.push( 'toBeCloseTo', expected, precision, expectationFailOutput );
				},
				
				get not() {
					expectation.push('not');
					return m;
				}
				
			}

			return <jasmine.Matchers<T>> m;
		};
	});
}

export async function setStringifyErrInClient(c: SpectronClient):
		Promise<void> {
	await c.execute(function() {
		function stringifyErr(err: any): string {
			if ((err as web3n.RuntimeException).runtimeException || !err
			|| (typeof err !== 'object')) {
				return `${JSON.stringify(err, null, '  ')}
`;
			} else {
				return `Error message: ${err.message}
		Error stack: ${err.stack}${
			((err as ErrorWithCause).cause ? `
		Caused by:
		${stringifyErr((err as ErrorWithCause).cause)}` :
			'')}
`;
			}
		}
		(<any> window).stringifyErr = stringifyErr;
	});
}

Object.freeze(exports);