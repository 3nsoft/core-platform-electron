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

/* 
 * This file starts service on socket ipc, to allow mocking with modules: dns,
 * https. Then a main script is required here, allowing us to have intact
 * application script, while still being able to mock things in node.
 */

import { commToClient, RequestEnvelope } from '../libs-for-tests/socket-ipc';
import { DnsTxtRecords, DNSMock } from '../libs-for-tests/dns';
import * as https from 'https';
import * as dns from 'dns';

const settingsPort = (() => {
	for (let arg of process.argv) {
		if (arg.startsWith('--wrap-settings-port=')) {
			let port = parseInt(arg.substring(21));
			if (isNaN(port)) { throw new Error('Bad settings port parameter.'); }
			return port;
		}
	}
	throw new Error('Settings port cli parameter is not given.');
})();

let tester = commToClient(settingsPort);

tester.addHandler('set-https-global-agent', (env: RequestEnvelope<string>) => {
	(<any> https.globalAgent).options.ca = env.req;
});

tester.addHandler('set-dns-mock', (env: RequestEnvelope<DnsTxtRecords>) => {
	let dnsMock = new DNSMock(env.req);
	dns.resolveTxt = dnsMock.resolveTxt;
});

// Load main script
require('../../main');