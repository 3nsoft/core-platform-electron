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

import { fork, ChildProcess } from 'child_process';
import { Duplex, commToChild } from '../../lib-common/ipc/node-child-ipc';
import { DnsTxtRecords } from './dns';
import { sleep } from '../../lib-common/processes';
import { readdirSync } from 'fs';

export interface ServiceUrls {
	mailerId: string;
	asmail: string;
	storage: string;
	signup: string;
	tlsCert: string;
}

function serverFolder(): string {
	let path = `${__dirname}/../../../../home-server`;
	try {
		readdirSync(path);
		return path;
	} catch (err) {
		return `${__dirname}/../../../../spec-server`;
	}
}

const DEFAULT_SERVER_SCRIPT_PATH =
	`${serverFolder()}/build/mock/mock-as-child-proc.js`;

const SERVER_MOCK_CHANNEL = 'server-mock';

export class ServicesRunner {

	private proc: ChildProcess = (undefined as any);
	private comm: Duplex = (undefined as any);
	
	constructor(private servScript = DEFAULT_SERVER_SCRIPT_PATH) {
		Object.seal(this);
	}

	async start(signupDomains: string[]): Promise<ServiceUrls> {
		try {
			// start child process
			this.proc = fork(this.servScript);
			this.comm = commToChild(SERVER_MOCK_CHANNEL, this.proc);
			this.proc.on('exit', () => {
				if (this.comm) { this.comm.close(); }
			});

			// start services
			let urls = await this.comm.makeRequest<ServiceUrls>('start', {
				midServiceDomain: 'localhost',
				signupDomains
			});
			return urls;

		} catch (err) {
			if (this.comm) {
				this.comm.close();
			}
			if (this.proc) {
				this.proc.kill('SIGKILL');
				this.proc = (undefined as any);
			}
			throw err;
		}
	}

	async stop(): Promise<void> {
		await this.comm.makeRequest<void>('stop', null);
		this.proc.kill('SIGTERM');
		this.proc = (undefined as any);
		this.comm = (undefined as any);
	}

	async setDns(recs: DnsTxtRecords): Promise<void> {
		await this.comm.makeRequest<void>('set-dns-mock', recs);
	}

}
Object.freeze(ServicesRunner.prototype);
Object.freeze(ServicesRunner);

Object.freeze(exports);