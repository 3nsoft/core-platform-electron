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

import { app } from 'electron';
import { addDevExtensions, removeDevExtensions } from '../ui/devtools';
import { InitProc } from '../ui/init-proc';
import { CLIENT_APP_DOMAIN } from '../ui/app-settings';
import { Core } from './core';
import { validateConfs, MockConfig } from './conf';
import { registerAllProtocolShemas } from "../lib-client/electron/protocols";
import { logError, logWarning } from '../lib-client/logging/log-to-file';
import { bind } from '../lib-common/binding';
import { readdirSync, readFileSync } from 'fs';
import { toCanonicalAddress } from '../lib-common/canonical-address';

const MOCK_CONF_POSTFIX = '.mock-conf.json';
const MOCK_CONFS_FOLDER = `${__dirname}/../mock-confs`;

const userConfs = new Map<string, { apps: string[]; mockConf: MockConfig; }>();
readdirSync(MOCK_CONFS_FOLDER)
.filter(fName => fName.endsWith(MOCK_CONF_POSTFIX))
.forEach(fName => {
	const confPath = `${MOCK_CONFS_FOLDER}/${fName}`;
	const confTxt = readFileSync(confPath, { encoding: 'utf8' });
	const mockConf: MockConfig = JSON.parse(confTxt);
	validateConfs(mockConf);
	const appDomain = fName
	.substring(0, fName.length - MOCK_CONF_POSTFIX.length)
	.split('.').reverse().join('.');
	mockConf.users
	.map(uInd => mockConf.mail.existingUsers[uInd].address)
	.map(toCanonicalAddress)
	.forEach(canonAddr => {
		let uConfs = userConfs.get(canonAddr);
		if (uConfs) {
			// XXX we may also add here merging of mockConf's for the same user
			if (!uConfs.apps.includes(appDomain)) {
				uConfs.apps.push(appDomain);
			}
		} else {
			userConfs.set(canonAddr, { apps: [ appDomain ], mockConf });
		}
	});
});

registerAllProtocolShemas();

const users = new Set<{ init: InitProc; core: Core; }>();

(global as any).getW3N = function(webContent: Electron.WebContents) {
	for (const u of users) {
		const w3n = u.init.getRemotedW3N(webContent);
		if (w3n) { return w3n; }
	}
	return;
};

app.on('ready', async () => {

	await addDevExtensions();

	for (const user of userConfs) {
		const init = new InitProc();
		const core = new Core(user[1].mockConf, bind(init, init.openViewer));
		await core.initFor(user[0]);
		for (const appDomain of user[1].apps) {
			await init.openInbuiltApp(appDomain, core.makeCAPs);
		}

		users.add({ init, core });
	}

});

app.on('window-all-closed', () => {
	removeDevExtensions();
	app.quit();
});


const unhandledRejections = new WeakMap();
process.on('unhandledRejection', async (reason, p) => {
	unhandledRejections.set(p, reason);
	await logError(reason, 'Unhandled exception');
});
process.on('rejectionHandled', async (p) => {
	const reason = unhandledRejections.get(p);
	await logWarning('Handling previously unhandled rejection', reason);
	unhandledRejections.delete(p);
});
