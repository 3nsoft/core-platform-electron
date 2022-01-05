/*
 Copyright (C) 2021 - 2022 3NSoft Inc.
 
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

import { assert } from "../lib-common/assert";
import { STARTUP_APP_DOMAIN, AppManifest } from '../app-init/app-settings';
import { checkAndTransformAddress, toCanonicalAddress, areAddressesEqual } from "../lib-common/canonical-address";
import { APP_ROOT_FOLDER, MANIFEST_FILE } from "../app-installer/unpack-zipped-app";
import { dirname, isAbsolute, join, resolve } from "path";
import { readFileSync, statSync, writeFileSync } from "fs";
import { errWithCause } from "../lib-common/exceptions/error";
import { AppCAPsAndSetup, AppSetter, CoreDriver } from "../core/core-driver";
import { Code } from "../lib-common/exceptions/file";
import { stringOfB64UrlSafeCharsSync } from "../lib-common/random-node";
import { Observer, Subject } from "rxjs";

export interface TestStandConfig {
	apps: { [appDomain: string]: DevApp; };
	users: DevUser[];
	userCreds?: string;
}

export interface DevApp {
	dir: string;
	url?: string;
}

export interface DevAppParams extends DevApp {
	manifest: AppManifest;
}

interface DevUser {
	idTemplate: string;
	signupToken?: string;
	testStartup?: true;
}

export interface DevUserParams {
	userId: string;
	pass: string;
	userNum: number;
	signupToken?: string;
	testStartup?: true;
}

interface TestStandCAP extends web3n.testing.TestStand {
	signalListeners: Map<string, Subject<any>[]>;
}

export interface AppsRunnerForTesting {
	runStartupDevApp: (
		params: DevAppParams, addTestStandCAP: WrapStartupCAPs
	) => Promise<{ coreInit: Promise<void>; }>;
	initForDirectStartup: () => ReturnType<CoreDriver['start']>;
	openApp: (appDomain: string) => Promise<void>;
}

export type WrapAppCAPsAndSetup = (
	cap: AppCAPsAndSetup
) => { w3n: web3n.testing.CommonW3N; close: () => void; setApp: AppSetter; };

export type WrapStartupCAPs =
	(cap: web3n.startup.W3N) => web3n.testing.StartupW3N;

export type MakeRunner = (userId: string) => AppsRunnerForTesting;

export type DevAppParamsGetter = (
	appDomain: string
) => { params: DevAppParams; wrapCAPs: WrapAppCAPsAndSetup; }|undefined;

export class TestStand {

	private readonly devUsers: DevUserParams[];
	private readonly devApps: Map<string, DevAppParams>;
	private readonly openCaps = new Map<string, TestStandCAP>();
	private testsStarted = false;
	private someSpecsExecuted = false;
	private haveFailedTests = false;

	constructor(
		conf: TestStandConfig, confFile: string,
		private readonly exitAll: (exitCode?: number) => void
	) {
		this.devUsers = parseUsersAndCreds(conf, confFile);
		this.devApps = parseApps(conf, confFile);
		Object.seal(this);
	}

	async bootAndStartDevApps(makeRunner: MakeRunner): Promise<void> {
		const started = await Promise.all(this.devUsers.slice(1)
		.map(async (userParams) => {
			const runner = makeRunner(userParams.userId);
			if (userParams.testStartup) {
				const appParams = this.devApps.get(STARTUP_APP_DOMAIN)!;
				assert(
					!!appParams,
					`Test user #${userParams.userNum} should be used with startup test, but ${STARTUP_APP_DOMAIN} app is not among tested apps.`
				);
				await startUserWithDevStartupApp(
					userParams, appParams, runner,
					this.makeBasicTestStand(STARTUP_APP_DOMAIN, userParams.userId));
			} else {
				await startUserDirectly(userParams, runner);
			}
			return runner;
		}));
		for (const runner of started) {
			for (const appDomain of this.devApps.keys()) {
				if (appDomain !== STARTUP_APP_DOMAIN) {
					runner.openApp(appDomain);
				}
			}
		}
	}

	devAppsGetter(userId: string): DevAppParamsGetter {
		const userParams = this.devUsers.slice(1).find(
			u => areAddressesEqual(u.userId, userId))!;
		assert(!!userParams);
		return appDomain => {
			const params = this.devApps.get(appDomain);
			if (!params) { return; }
			const { testStand, closeCAP } = this.makeTestStandCAP(
				userParams, appDomain);
			const wrapCAPs: WrapAppCAPsAndSetup = ({ w3n, setApp, close }) => {
				const w3nWithStand = { testStand } as web3n.testing.CommonW3N;
				for (const cap in w3n) {
					w3nWithStand[cap] = w3n[cap];
				}
				const wrappedClose = () => {
					close();
					closeCAP();
				};
				return { w3n: w3nWithStand, setApp, close: wrappedClose };
			}
			return { params, wrapCAPs };
		};
	}

	private makeBasicTestStand(
		app: string, userId: string
	): web3n.testing.BasicTestStand {
		return {

			log: async (type, msg, err) => {
				if (type === 'error') {
					console.log(`ERROR in ${app}, user '${userId}'\n${msg}\n`, err);
				} else if (type === 'info') {
					console.log(`INFO from ${app}, user '${userId}'\n${msg}\n`);
				} else if (type === 'warning') {
					console.log(`WARNING in ${app}, user '${userId}'\n${msg}\n`);
				}
			},

			record: async (type, msg) => {
				if (type === 'spec-pass') {
					this.someSpecsExecuted = true;
					console.log(`PASS: ${msg}`);
				} else if (type === 'spec-pending') {
					console.log(`PENDING: ${msg}`);
				} else if (type === 'spec-fail') {
					this.someSpecsExecuted = true;
					this.haveFailedTests = true;
					console.log(`FAIL: ${msg}`);
				} else if (type === 'suite-fail') {
					this.haveFailedTests = true;
					console.log(`FAIL: ${msg}`);
				} else if (type === 'tests-start') {
					this.testsStarted = true;
					console.log(`\nTests started in ${app}\nwith test user '${userId}'.\n`);
				} else if (type === 'tests-pass') {
					console.log(`\nTests passed in ${app}\nwith test user '${userId}'.\n${msg}`);
				} else if (type === 'tests-fail') {
					this.haveFailedTests = true;
					console.log(`\nTests failed in ${app}\nwith test user '${userId}'.\n${msg}`);
				} else {
					assert(false, `Type ${type} is unknown`);
				}
			},

			exitAll: async () => {
				const ok = (this.testsStarted ?
					(!(this.haveFailedTests || !this.someSpecsExecuted)) : true);
				this.exitAll(ok ? 0 : 2);
			},

		};
	}

	private makeTestStandCAP(
		{ userId, userNum }: DevUserParams, appDomain: string
	): { testStand: TestStandCAP; closeCAP: () => void; } {
		const capId = capIdFor(userNum, appDomain);
		assert(
			!this.openCaps.has(capId),
			`Current test stand can work only with one open dev app. And init process also expects just one opened app. Multi-instance flag should be added at some point.`
		);
		const { log, record, exitAll } = this.makeBasicTestStand(
			appDomain, userId);
		const testStand: TestStandCAP = {

			log,
			record,
			exitAll,

			staticTestInfo: async () => ({ userId, userNum }),

			idOfTestUser: async userNum => {
				const user = this.devUsers[userNum];
				if (user) {
					return user.userId;
				} else {
					throw new Error(`No user found with number ${userNum}`);
				}
			},

			observeMsgsFromOtherLocalTestUser: (sender, senderApp, obs) => {
				const sendingCapId = capIdFor(
					sender, (senderApp ? senderApp : appDomain));
				const otherCAP = this.openCaps.get(sendingCapId)!;
				assert(!!otherCAP);
				const signalSink = new Subject<any>();
				if (otherCAP.signalListeners.has(capId)) {
					otherCAP.signalListeners.get(capId)!.push(signalSink);
				} else {
					otherCAP.signalListeners.set(capId, [ signalSink ]);
				}
				const sub = signalSink.asObservable()
				.subscribe(obs as Observer<any>);
				return () => {
					sub.unsubscribe();
					const listeners = otherCAP.signalListeners.get(capId);
					if (!listeners) { return; }
					const ind = listeners.indexOf(signalSink);
					if (ind >= 0) {
						listeners.splice(ind, 1);
					}
					if (listeners.length === 0) {
						otherCAP.signalListeners.delete(capId);
					}
				};
			},

			sendMsgToOtherLocalTestUser: async (recipient, recipientApp, msg) => {
				const listenerId = capIdFor(
					recipient, (recipientApp ? recipientApp : appDomain));
				const listeners = testStand.signalListeners.get(listenerId);
				if (!listeners) { return; }
				for (const sink of listeners) {
					sink.next(msg);
				}
			},

			signalListeners: new Map(),

		};
		this.openCaps.set(capId, testStand);
		const closeCAP = () => {
			if (this.openCaps.delete(capId)) {
				for (const listeners of testStand.signalListeners.values()) {
					for (const sink of listeners) {
						sink.complete();
					}
				}
				testStand.signalListeners.clear();
			}
		};
		return { testStand, closeCAP };
	}

}
Object.freeze(TestStand.prototype);
Object.freeze(TestStand);


function parseApps(
	conf: TestStandConfig, confFile: string
): Map<string, DevAppParams> {
	const apps = new Map<string, DevAppParams>();
	assert(
		(typeof conf.apps === 'object') && (Object.keys(conf.apps).length > 0),
		`At least one test app should be set in test stand configuration.`
	);
	for (const appDomain of Object.keys(conf.apps)) {
		const app = conf.apps[appDomain];
		assert(
			typeof app === 'object',
			`Test stand app configuration should be an object.`
		);
		const { dir, url } = app;
		assert(
			typeof dir === 'string',
			`Test stand app configuration should have string 'dir' field.`
		);
		assert(
			(url === undefined) || (typeof url === 'string'),
			`If 'url' field is present in test stand app configuration, it should be a string.`
		);
		const { appDir, manifest } = checkAppDir(
			isAbsolute(dir) ? dir : resolve(dirname(confFile), dir)
		);
		assert(
			manifest.appDomain === appDomain,
			`App domain '${appDomain}' in test stand configuration should be equal to appDomain value in manifest file '${join(app.dir, MANIFEST_FILE)}'.`
		);
		apps.set(appDomain, {
			dir: appDir, manifest, url
		});
	}
	return apps;
}


function checkAppDir(dir: string): { manifest: AppManifest; appDir: string; } {
	try {
		const appDir = join(dir, APP_ROOT_FOLDER);
		const stats = statSync(appDir);
		if (!stats.isDirectory()) { throw new Error(
			`Path ${appDir} is not a directory with UI app code`
		); }
		const manifFile = join(dir, MANIFEST_FILE);
		const str = readFileSync(manifFile, { encoding: 'utf8' });
		const manifest = JSON.parse(str) as AppManifest;
		return { manifest, appDir };
	} catch (err) {
		throw errWithCause(err, `${dir} doesn't seem to be a folder with UI app code and app manifest`);
	}
}

function parseUsersAndCreds(
	conf: TestStandConfig, confFile: string
): DevUserParams[] {
	const users: DevUserParams[] = [];
	assert(
		Array.isArray(conf.users),
		`users should be an array in test stand configuration.`
	);
	assert(
		(conf.users.length > 0),
		`At least one test user should be set in test stand configuration.`
	);
	const creds = readOrGenerateCreds(
		confFile, conf.userCreds, conf.users);
	creds.map(({ userId, pass }, i) => {
		const user = conf.users[i];
		const userNum = i + 1;

		const canonicalAddress = checkAndTransformAddress(userId);
		assert(
			!!canonicalAddress,
			`Test stand user id '${userId}' in configuration is not a valid 3NWeb address.`
		);
		assert(
			typeof user === 'object',
			`Test stand user configuration should be an object.`
		);
		const { signupToken, testStartup } = user;
		assert(
			typeof userNum === 'number',
			`Test stand user configuration should have numeric 'numId' field.`
		);
		assert(
			(signupToken === undefined) || (typeof signupToken === 'string'),
			`If 'signupToken' field is present in test stand user configuration, it should be a string.`
		);
		users[userNum] = { userId, userNum, signupToken, pass, testStartup };
	});
	return users;
}

const DEFAULT_CREDS_FILE = "test-user-creds.json";

type FileException = web3n.files.FileException;

type UserCreds = [string, string][];

function readOrGenerateCreds(
	confFile: string, credsFile: string|undefined, users: DevUser[]
): { userId: string; pass: string; }[] {
	if (!credsFile) {
		credsFile = resolve(dirname(confFile), DEFAULT_CREDS_FILE);
	} else if (!isAbsolute(credsFile)) {
		credsFile = resolve(dirname(confFile), credsFile);
	}

	let creds: UserCreds;
	let credsUpdated = false;
	try {
		creds = JSON.parse(readFileSync(credsFile, { encoding: 'utf8' }));
		assert(
			Array.isArray(creds),
			`Content of creds file ${credsFile} should be an array.`
		);
	} catch (err) {
		if ((err as FileException).code === Code.notFound) {
			creds = [];
		} else {
			throw errWithCause(err, `Problem reading test user creds file at ${credsFile}`);
		}
	}

	for (let i=0; i<users.length; i+=1) {
		let idAndPass = creds[i];
		if (idAndPass) {
			assert(
				Array.isArray(idAndPass) && (idAndPass.length === 2),
				`Element ${i+1} in creds file ${credsFile} should be a two-element array with user id and a pass.`
			);
			const [ userId, pass ] = idAndPass;
			assert(
				(typeof userId === 'string') && !!checkAndTransformAddress(userId),
				`Element ${i+1} in creds file ${credsFile} should have a valid user id at its first position.`
			);
			assert(
				typeof pass === 'string',
				`Test user '${idAndPass[0]}' credential is not a string in file '${credsFile}'.`
			);
		} else {
			const { idTemplate } = users[i];
			assert(
				typeof idTemplate === 'string',
				`Test stand user configuration should have string idTemplate in user ${i+1}.`
			)
			const userId = idTemplate.replace('%d', `${Date.now()}`);
			assert(
				!!checkAndTransformAddress(userId),
				`idTemplate for user ${i+1} in configuration doesn't yield valid address`
			);
			const pass = stringOfB64UrlSafeCharsSync(20);
			creds.push([ userId, pass ]);
			credsUpdated = true;
		}
	}

	if (credsUpdated) {
		writeFileSync(
			credsFile, JSON.stringify(creds, null, 2), { encoding: 'utf8' }
		);
	}
	return creds.map(([ userId, pass ]) => ({ userId, pass }));
}

async function startUserWithDevStartupApp(
	{ userId, pass, userNum, signupToken }: DevUserParams,
	appParams: DevAppParams, runner: AppsRunnerForTesting,
	baseStand: web3n.testing.BasicTestStand
): Promise<void> {
	const addTestCAP: WrapStartupCAPs = ({ signIn, signUp }) => {
		const testStand: web3n.testing.StartupTestStand = {
			staticTestInfo: async () => ({ userId, pass, userNum, signupToken }),
			log: baseStand.log,
			record: baseStand.record,
			exitAll: baseStand.exitAll,
		};
		return { signIn, signUp, testStand };
	};
	const { coreInit } = await runner.runStartupDevApp(appParams, addTestCAP);
	await coreInit;
}

async function startUserDirectly(
	{ userId, pass, signupToken }: DevUserParams, runner: AppsRunnerForTesting
): Promise<void> {
	const canonicalAddress = toCanonicalAddress(userId);
	const {
		capsForStartup: { signIn, signUp },
		coreInit
	} = runner.initForDirectStartup();
	const usersOnDisk = await signIn.getUsersOnDisk();
	if (usersOnDisk.find(u => areAddressesEqual(u, userId))) {
		console.log(`Login of '${userId}' with existing storage cache:`);
		let progressIndicated = false;
		const ok = await signIn.useExistingStorage(userId, pass, p => {
			if (!progressIndicated) {
				console.log(`Login of '${userId}' in progress`);
				progressIndicated = true;
			}
		});
		assert(ok, `Configuration should have correct pasword for '${userId}'.`);
		console.log(`User '${userId}' logged in.`);
	} else {
		const indOfAt = canonicalAddress.lastIndexOf('@');
		assert(
			indOfAt > 0,
			`Test signup assumes full address with name, but '${userId}' isn't.`
		);
		const nonNameLen = canonicalAddress.length - indOfAt;
		const name = userId.slice(0, userId.length - nonNameLen);
		const unused = await signUp.getAvailableAddresses(name, signupToken);
		if (unused.includes(userId)) {
			console.log(`Creating user '${userId}':`);
			let progressIndicated = false;
			await signUp.createUserParams(pass, p => {
				if (!progressIndicated) {
					console.log(`Creation of '${userId}' in progress`);
					progressIndicated = true;
				}
				console.log(`Creating keys for '${userId}': ${p}%`);
			});
			const ok = await signUp.addUser(userId, signupToken);
			assert(ok, `User creation failed.`);
			console.log(`User '${userId}' created.`);
		} else {
			console.log(`Login of '${userId}' without local storage cache:`);
			const userKnown = await signIn.startLoginToRemoteStorage(userId);
			assert(userKnown);
			let progressIndicated = false;
			const ok = await signIn.completeLoginAndLocalSetup(pass, p => {
				if (!progressIndicated) {
					console.log(`Login of '${userId}' in progress`);
					progressIndicated = true;
				}
			});
			assert(ok, `Configuration should have correct pasword for '${userId}'.`);
			console.log(`User '${userId}' logged in.`);
		}
	}
	await coreInit;
}

function capIdFor(userNum: number, appDomain: string): string {
	return `${userNum}/${appDomain}`;
}


Object.freeze(exports);