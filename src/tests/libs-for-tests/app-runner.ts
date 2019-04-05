/*
 Copyright (C) 2016 - 2018 3NSoft Inc.
 
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

import { commToServer, RequestingClient } from './socket-ipc';
import { DnsTxtRecords } from './dns';
import { rmDirWithContent, FileException }
	from '../../lib-common/async-fs-node';
import { resolve } from 'path';
import { stringOfB64Chars } from '../../lib-common/random-node';
import { sleep } from '../../lib-common/processes';
import { setRemoteJasmineInClient, setStringifyErrInClient, exec }
	from './remote-js-utils';
import { displayBrowserLogs, displayStdOutLogs } from './spectron-logs';
import { Application, SpectronClient } from 'spectron';
import { DATA_ARG_NAME } from '../../lib-client/local-files/app-files';

const SETTINGS_PORT = 18088;
const WEBDRIVER_PORT = 28088;
const DATA_FOLDER = 'test-data';

export type User = appTesting.User;

declare var w3n: {
	signUp: web3n.startup.SignUpService;
	signIn: web3n.startup.SignInService;
}

let numOfRunningApps = 0;

export class AppRunner implements appTesting.ClientRunner {

	private spectron: Application = (undefined as any);
	private appMocker: RequestingClient = (undefined as any);
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
	 * This is a Webdriver Client, provided by spectron.
	 */
	get c(): SpectronClient {
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
			args: [ './build/all/tests/wrapped-app-scripts/main.js',
				`--signup-url=${this.signupUrl}`, `${DATA_ARG_NAME}=${dataFolder}`,
				`--wrap-settings-port=${settingsPort}`, `--allow-multi-instances` ]
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
		return rmDirWithContent(resolve(__dirname, `../../../../${dataFolder}`))
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
			this.spectron = (undefined as any);
		}
	}

	async restart(loginUser = false): Promise<void> {
		await this.stop();
		await sleep(1000);
		await this.startInternals();
		if (this.dnsRecs) {
			await this.setDns(this.dnsRecs);
		}
		if (loginUser) {
			await this.loginUser();
		}
	}

	/**
	 * @param recs is a complete set of records for DNS mock in the an
	 * application.
	 * @return a promise, resolvable, when application's DNS mock is set to given
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
		const initWinId = await this.currentWinId();
		if (!initWinId) { throw new Error(`Can't get window id`); }

		const pass = await stringOfB64Chars(16);
		this.c.timeouts('script', 59000);
		await setStringifyErrInClient(this.c);
		await exec(this.c, async function(userId: string, pass: string) {
			await w3n.signUp.createUserParams(pass, () => {});
			const isCreated = await w3n.signUp.addUser(userId);
			if (!isCreated) { throw new Error(
				`Cannot create user ${userId}. It may already exists.`); }
		}, userId, pass);
		this.c.timeouts('script', 5000);

		await this.switchWindows(200, initWinId);

		await setRemoteJasmineInClient(this.c);
		await setStringifyErrInClient(this.c);
		this.user = { userId, pass };
		return this.user;
	}

	async loginUser(): Promise<void> {
		const initWinId = await this.currentWinId();
		if (!initWinId) { throw new Error(`Can't get window id`); }

		this.c.timeouts('script', 59000);
		await setStringifyErrInClient(this.c);
		await exec(this.c, async function(user: User) {
			const usersOnDisk = await w3n.signIn.getUsersOnDisk();
			let isLogged: boolean;
			if (usersOnDisk.find(userOnDisk => (userOnDisk === user.userId))) {
				isLogged = await w3n.signIn.useExistingStorage(
					user.userId, user.pass, () => {});
			} else {
				const userExists = await w3n.signIn.startLoginToRemoteStorage(
					user.userId);
				if (!userExists) { throw new Error(
					`Attempt to login ${user.userId} fails, cause server doesn't recongize this user.`); }
				isLogged = await w3n.signIn.completeLoginAndLocalSetup(
					user.pass, () => {});
			}
			if (!isLogged) { throw new Error(
				`Cannot create user ${user.userId}. It may already exists.`); }
		}, this.user);
		this.c.timeouts('script', 5000);

		await this.switchWindows(200, initWinId);

		await setRemoteJasmineInClient(this.c);
		await setStringifyErrInClient(this.c);
	}

	private async currentWinId(): Promise<string|undefined> {
		try {
			return (await this.c.windowHandle()).value;
		} catch (err) {
			return;
		}
	}

	private async switchWindows(sleepPeriod: number, initWinId: string):
			Promise<void> {
		let winId: string|undefined;
		do {
			await sleep(sleepPeriod);
			await this.c.windowByIndex(0).catch(() => {});
			winId = await this.currentWinId();
		} while (!winId || (winId === initWinId));
	}
	
	async displayBrowserLogs(): Promise<void> {
		await displayBrowserLogs(this);
	}

	async displayStdOutLogs(): Promise<void> {
		await displayStdOutLogs(this);
	}

}
Object.freeze(AppRunner.prototype);
Object.freeze(AppRunner);

Object.freeze(exports);