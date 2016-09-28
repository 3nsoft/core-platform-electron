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

import { AppRunner, User } from '../libs-for-tests/app-runner';
import { ServicesRunner, ServiceUrls } from './services-runner';
import { displayBrowserLogs, displayStdOutLogs } from './spectron-logs';
import { DnsTxtRecords } from './dns';
import { beforeAllAsync, afterAllAsync, afterEachAsync } from './async-jasmine';
import { sleep } from '../../lib-common/processes';
import { ErrorWithCause } from '../../lib-common/exceptions/error';

export interface Setup {

	app: AppRunner;
	c: WebdriverIO.Client<any>;

	signupDomains: string[];

	start(): Promise<void>;
	stop(): Promise<void>;

	displayBrowserLogs(): Promise<void>;
	displayStdOutLogs(): Promise<void>;

}
	
function dnsRecsFrom(signupDomains: string[], urls: ServiceUrls):
		DnsTxtRecords {
	let recs: DnsTxtRecords = {};
	for (let d of signupDomains) {
		// DNS records with and without spaces should be acceptable
		recs[d] = [
			[ 'asmail', '=', urls.asmail ],	// DNS txt with spaces
			[ 'mailerid=', urls.mailerId ],	// DNS txt with space
			[ `3nstorage=${urls.storage}` ]	// DNS txt without spaces
		];
	}
	return recs;
}

export function makeSetupObject(signupDomains: string[]): Setup {
	
	let app = new AppRunner();
	let server = new ServicesRunner();

	let setup: Setup = {
		get app(): AppRunner { return app; },
		get c(): WebdriverIO.Client<any> { return app.c; },
		
		get signupDomains(): string[] { return signupDomains; },

		async start(): Promise<void> {
			let urls = await server.start(signupDomains);
			let recs = dnsRecsFrom(signupDomains, urls);
			await server.setDns(recs);
			await app.start(urls.signup, urls.tlsCert);
			await app.setDns(recs);
		},
		async stop() {
			await app.stop();
			await server.stop();
		},

		async displayBrowserLogs(): Promise<void> {
			await displayBrowserLogs(app)
		},
		async displayStdOutLogs(): Promise<void> {
			await displayStdOutLogs(app)
		}
	};

	return setup;
}

/**
 * This creates a minimal working setup of app and server, and calls simple
 * before and after methods, that do start and stop of everything.
 * @param signupDomains are domains, for which server will create users.
 * @return a setup object, for access to webdriver client, for restarting
 * mid-test, etc.
 */
export function minimalSetup(
		signupDomains = [ 'company.inc', 'personal.net' ]): Setup {

	let s = makeSetupObject(signupDomains);

	beforeAllAsync(async () => {
		await s.start();
	});

	afterAllAsync(async () => {
		await s.stop();
		await s.app.removeDataFolder();
	});

	afterEachAsync(async () => {
		await s.displayBrowserLogs();
	});
	
	return s;
}

export interface MultiUserSetup {

	users: User[];
	apps: Map<string, AppRunner>;
	c(userId: string): WebdriverIO.Client<any>;

	signupDomains: string[];

	start(): Promise<void>;
	stop(): Promise<void>;
	createUser(userId: string): Promise<User>;

	displayBrowserLogs(): Promise<void>;
	displayStdOutLogs(): Promise<void>;

}

export function makeMultiUserSetupObject(signupDomains: string[]):
		MultiUserSetup {
	
	let apps = new Map<string, AppRunner>();
	let server = new ServicesRunner();
	let urls: ServiceUrls;
	let recs: DnsTxtRecords;
	let users: User[] = [];

	let setup: MultiUserSetup = {
		apps,
		users,
		c(userId: string): WebdriverIO.Client<any> {
			let app = apps.get(userId);
			if (!app) { throw new Error(`No app set for user ${userId}`); }
			return app.c;
		},
		
		get signupDomains(): string[] { return signupDomains; },

		async start(): Promise<void> {
			urls = await server.start(signupDomains);
			recs = dnsRecsFrom(signupDomains, urls);
			await server.setDns(recs);
		},
		async stop() {
			for (let app of apps.values()) {
				await app.stop();
			}
			await server.stop();
		},
		async createUser(userId: string): Promise<User> {
			let app = new AppRunner();
			await app.start(urls.signup, urls.tlsCert);
			await app.setDns(recs);
			apps.set(userId, app);
			let user = await app.createUser(userId);
			users.push(user);
			return user;
		},

		async displayBrowserLogs(): Promise<void> {
			for (let app of apps.values()) {
				await displayBrowserLogs(app)
			}
		},
		async displayStdOutLogs(): Promise<void> {
			for (let app of apps.values()) {
				await displayStdOutLogs(app)
			}
		}
	};

	return setup;
}

/**
 * This function creates users inside of usual
 * @param users is a list of user ids to create. Default users are created,
 * if no value given.
 * Setup automatically sets DNS for domains from these ids.
 * @return a setup object, for access to webdriver client, for restarting
 * mid-test, etc.
 */
export function setupWithUsers(users = ['Bob Marley @rock.cafe']):
		MultiUserSetup {
	if (users.length === 0) { throw new Error('No user given to setup.'); }

	let signupDomains = [];
	for (let address of users) {
		let indAt = address.indexOf('@');
		if (indAt < 0) {
			signupDomains.push(address);
		} else {
			signupDomains.push(address.substring(indAt+1));
		}
	}

	let s = makeMultiUserSetupObject(signupDomains);

	beforeAllAsync(async () => {
		await s.start();
		for (let address of users) {
			await s.createUser(address);
		}
		await sleep(2000);
	}, users.length*40000);

	afterAllAsync(async () => {
		await s.stop();
		for (let app of s.apps.values()) {
			await app.removeDataFolder();
		}
	});

	afterEachAsync(async () => {
		await s.displayBrowserLogs();
	});
	
	return s;
}

/**
 * This inserts into client's window an awaiter function, which TS insert into
 * compiled JS6, and uses it to expand await clause.
 * Note 1: when await becomes native, this function becomes absolete, but it
 * would do nothing, when TS is not making expansions for JS6 compile target.
 * Note 2: expanson for JS5 and JS3 compile targets is different, but we do not
 * use these in the project, as electron's chrome is already at JS6.
 * @param app
 * @return a promise, resolvable, when injection is done. 
 */
export async function setAwaiterJS6InClient(app: AppRunner): Promise<void> {
	await app.c.execute(function() {
		(<any> window).__awaiter = function (thisArg, _arguments, P, generator) {
			return new (P || (P = Promise))(function (resolve, reject) {
				function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
				function rejected(value) { try { step(generator.throw(value)); } catch (e) { reject(e); } }
				function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
				step((generator = generator.apply(thisArg, _arguments)).next());
			});
		};
	});
}

type CollectedExpectations = (any[] | { isFail: boolean; e: string; })[];

/**
 * @param exps is an array of jasmine expectations from client side, assembled
 * by inject in setRemoteJasmineInClient(app) function; 
 */
export function checkRemoteExpectations(exps: CollectedExpectations,
		numOfExpectations?: number): void {
	if (typeof numOfExpectations === 'number') {
		expect(exps.length).toBe(numOfExpectations, 'total number of reported checks from a remote side');
	}
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
}

export async function setRemoteJasmineInClient(app: AppRunner): Promise<void> {
	await app.c.execute(function() {

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

		(<any> window).cExpect = (actual: any): jasmine.Matchers => {
		
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

			return <jasmine.Matchers> m;
		};
	});
}

Object.freeze(exports);