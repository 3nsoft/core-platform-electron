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

export function itAsync(expectation: string,
		assertion?: (done?: DoneFn) => Promise<void>, timeout?: number): void {
	if (assertion) {
		it(expectation, async (done) => {
			try {
				await assertion(done);
				done();
			} catch (err) {
				done.fail(err);
			}
		}, timeout);
	} else {
		it(expectation);
	}
}

export function xitAsync(expectation: string,
		assertion?: (done?: DoneFn) => Promise<void>, timeout?: number): void {
	xit(expectation, async (done) => {
		try {
			await assertion(done);
			done();
		} catch (err) {
			done.fail(err);
		}
	}, timeout);
}

export function fitAsync(expectation: string,
		assertion?: (done?: DoneFn) => Promise<void>, timeout?: number): void {
	fit(expectation, async (done) => {
		try {
			await assertion(done);
			done();
		} catch (err) {
			done.fail(err);
		}
	}, timeout);
}

export function beforeAllAsync(action: () => Promise<void>, timeout?: number) {
	beforeAll(async (done) => {
		try {
			await action();
			done();
		} catch (err) {
			done.fail(err);
		}
	}, timeout);
}

export function afterAllAsync(action: () => Promise<void>, timeout?: number) {
	afterAll(async (done) => {
		try {
			await action();
			done();
		} catch (err) {
			done.fail(err);
		}
	}, timeout);
}

export function beforeEachAsync(action: () => Promise<void>, timeout?: number) {
	beforeEach(async (done) => {
		try {
			await action();
			done();
		} catch (err) {
			done.fail(err);
		}
	}, timeout);
}

export function afterEachAsync(action: () => Promise<void>, timeout?: number) {
	afterEach(async (done) => {
		try {
			await action();
			done();
		} catch (err) {
			done.fail(err);
		}
	}, timeout);
}

Object.freeze(exports);