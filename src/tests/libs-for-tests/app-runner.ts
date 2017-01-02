/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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

import { commToServer, Duplex } from './socket-ipc';
import { DnsTxtRecords } from './dns';
import { rmDirWithContent, FileException }
	from '../../lib-common/async-fs-node';
import { resolve } from 'path';
import { stringOfB64Chars } from '../../lib-client/random-node';
import { sleep } from '../../lib-common/processes';
import { setAwaiterJS6InClient, setRemoteJasmineInClient }
	from './remote-js-utils';
const Application = require('spectron').Application;

const SETTINGS_PORT = 18088;
const WEBDRIVER_PORT = 28088;
const DATA_FOLDER = 'test-data';

export interface User {
	userId: string;
	pass: string;
}

declare var w3n: {
	signUp: web3n.startup.SignUpService;
	signIn: web3n.startup.SignInService;
}

let numOfRunningApps = 0;

export class AppRunner {

	private spectron: any = undefined;
	private appMocker: Duplex = (undefined as any);
	public user: User = (undefined as any);
	private signupUrl: string = (undefined as any);
	private tlsCert: string = (undefined as any);
	private dnsRecs: DnsTxtRecords = (undefined as any);
	private appNum: number = (undefined as any);

	constructor() {
		this.appNum = numOfRunningApps;
		numOfRunningApps += 1;
		Object.seal(this);
	}

	/**
	 * This is a spectron appliaction object.
	 * At this moment, type information is missing, thus "any" is used.
	 */
	get spectronApp(): any {
		return this.spectron;
	}

	/**
	 * This is a Webdriver Client, provided by spectron.
	 */
	get c(): WebdriverIO.Client<any> {
		if (!this.spectron || !this.spectron.isRunning()) {
			throw new Error('Spectron is not running'); }
		return this.spectron.client;
	}

	/**
	 * This starts spectron that drives an application in a wrap with a DNS mock
	 * and a tls cert injector.
	 * @param signupUrl is a signup url without 'https://', which an application
	 * should use.
	 * @param tlsCert is a string with self signed crt, that should be trusted in
	 * to connect to test server.
	 */
	async start(signupUrl: string, tlsCert?: string): Promise<void> {
		this.signupUrl = signupUrl;
		if (tlsCert) {
			this.tlsCert = tlsCert;
		}
		await this.startInternals();
	}

	private async startInternals(): Promise<void> {
		let settingsPort = SETTINGS_PORT + this.appNum;
		let port = WEBDRIVER_PORT + this.appNum;
		let dataFolder = `./${DATA_FOLDER}-${this.appNum}`;
		this.spectron = new Application({
			port,
			path: './node_modules/.bin/electron',
			args: [ './build/tests/wrapped-app-scripts/main.js',
				`--signup-url=${this.signupUrl}`, `--data-dir=${dataFolder}`,
				`--wrap-settings-port=${settingsPort}` ]
		});
		await this.spectron.start();
		this.appMocker = commToServer(settingsPort);
		if (this.tlsCert) {
			await this.appMocker.makeRequest<void>(
				'set-https-global-agent', this.tlsCert);
		}
	}

	/**
	 * @return a promise, resolvable when test data folder is completely removed.
	 */
	removeDataFolder(): Promise<void> {
		let dataFolder = `${DATA_FOLDER}-${this.appNum}`;
		return rmDirWithContent(resolve(__dirname, `../../../${dataFolder}`))
		.catch((exc: FileException) => { if (!exc.notFound) { throw exc; } });
	}

	/**
	 * This method stops spectron that drives an application, but it does not
	 * erase application's test data folder.
	 * @return a promise, resolvable when spectron with an app are closed.
	 */
	async stop(): Promise<void> {
		if (this.spectron && this.spectron.isRunning()) {
			try {
				this.appMocker.close();
				this.appMocker = (undefined as any);
			} catch (err) {}
			await this.spectron.stop();
			this.spectron = undefined;
		}
	}

	async restart(): Promise<void> {
		await this.stop();
		await sleep(1000);
		await this.startInternals();
		if (this.dnsRecs) {
			this.setDns(this.dnsRecs);
		}
	}

	/**
	 * @param recs is a complete set of records for DNS mock in the an
	 * application.
	 * @return a rpomise, resolvable, when application's DNS mock is set to given
	 * values.
	 */
	async setDns(recs: DnsTxtRecords): Promise<void> {
		this.dnsRecs = recs;
		await this.appMocker.makeRequest<void>('set-dns-mock', this.dnsRecs);
	}

	/**
	 * This function creates a user via an application, i.e. with less mocking.
	 * An application is expected to be running for this to work.
	 * When user is created, application is transitioned into main mode.
	 * If this is not required, one may stop an app, restart it, remove app data
	 * folder in between, etc.
	 * @param userId is an address for new user.
	 * @return a promise, resolvable to a user object with id and passes.
	 */
	async createUser(userId: string): Promise<User> {
		if (this.user) { throw new Error('App already has associated user.'); }
		let pass = stringOfB64Chars(16);
		(this.c as any).timeouts('script', 59000);
		let err = (await this.c.executeAsync(function(userId: string,
				pass: string, done: Function) {
			w3n.signUp.createUserParams(pass, (p) => {})
			.then(() => {
				return w3n.signUp.addUser(userId);
			})
			.then((isCreated) => {
				if (isCreated) { done(); }
				else { throw new Error(`Cannot create user ${userId}. It may already exists.`); }
			})
			.catch(e => done(e));
		}, userId, pass)).value;
		if (err) {
			console.error(`Error occured when creating user ${userId}`);
			console.error(JSON.stringify(err, null, '  '));
			throw err;
		}
		(this.c as any).timeouts('script', 5000);
		await sleep(200);
		await (<any> this.c).windowByIndex(0);
		await setRemoteJasmineInClient(this.c);
		await setAwaiterJS6InClient(this.c);
		this.user = { userId, pass };
		return this.user;
	}

}
Object.freeze(AppRunner.prototype);
Object.freeze(AppRunner);

Object.freeze(exports);