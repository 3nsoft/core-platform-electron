/*
 Copyright (C) 2016 - 2017, 2019 3NSoft Inc.
 
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
import { InitProc } from '../ui/init-proc';
import { Core } from './core';
import { validateConfs, MockConfig } from './conf';
import { registerAllProtocolShemas } from "../lib-client/electron/protocols";
import { recordUnhandledRejectionsInProcess } from '../lib-client/logging/log-to-file';
import { bind } from '../lib-common/binding';
import { readdirSync, readFileSync } from 'fs';
import { toCanonicalAddress } from '../lib-common/canonical-address';
import { join, sep } from 'path';
import { FileException } from '../lib-common/async-fs-node';
import { Code } from '../lib-common/exceptions/file';

function printUsage(out: typeof console.log): void {
	out(`
Usage:
	...${sep}3nweb --app-dir=app1 [--app-dir=app2 ...] [--data-dir=data_folder] [--devtools]
Options:
	--app-dir=folder - this option must be present with folder for at least one app, that is to be opened.
	--data-dir=folder - tells which folder to use for data.
	--devtools - allows to open chrome dev tools with common shortcuts like <Ctrl+Shift+I>, and adds refreshing with <Ctrl+R>.
`);
}

const MOCK_CONF_FILE = 'mock-conf.json';

const appsFromFolders = process.argv
.filter(arg => arg.startsWith('--app-dir='))
.map(arg => arg.substring(10))
.map(folder => {
	try {
		const mockConfPath = join(folder, MOCK_CONF_FILE);
		const mockStr = readFileSync(mockConfPath, { encoding: 'utf8' });
		const conf = JSON.parse(mockStr) as MockConfig;
		validateConfs(conf);
		return [folder, conf];
	} catch (exc) {
		console.error(`Can't read mock configuration file in folder ${folder}`);
		console.error(exc);
		return;
	}
})
.filter(conf => !!conf) as [string, MockConfig][];

const userConfs = new Map<string, { apps: string[]; mockConf: MockConfig; }>();

if (appsFromFolders.length === 0) {
	try {
		const MOCK_CONF_POSTFIX = '.mock-conf.json';
		const MOCK_CONFS_FOLDER = `${__dirname}/../mock-confs`;
		const confFiles = readdirSync(MOCK_CONFS_FOLDER)
		.filter(fName => fName.endsWith(MOCK_CONF_POSTFIX));
		if (confFiles.length === 0) {
			console.error(`No mock configuration files found for inbuilt app(s) in ${MOCK_CONFS_FOLDER}`);
			process.exit(1);
		}
		confFiles.forEach(fName => {
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
		// missing or incorrect configurations
		if (userConfs.size === 0) {
			console.error(`No user configurations picked up from mock configuration files in ${MOCK_CONFS_FOLDER}`);
			process.exit(1);
		}
	} catch (exc) {
		if ((exc as FileException).code === Code.notFound) {
			// case of packaged mock
			console.error(`Missing --app-dir argument(s) that point to 3N apps to open`);
			printUsage(console.error);
			process.exit(1);
		}
		console.error(`Have problem getting mock configurations: `, exc);
		process.exit(1);
	}
} else {
	appsFromFolders
	.forEach(([ folder, mockConf ]) => {
		mockConf.users
		.map(userIndex => mockConf.mail.existingUsers[userIndex].address)
		.map(toCanonicalAddress)
		.forEach(canonAddr => {
			let uConfs = userConfs.get(canonAddr);
			if (uConfs) {
				// XXX we may also add here merging of mockConf's for the same user
				if (!uConfs.apps.includes(folder)) {
					uConfs.apps.push(folder);
				}
			} else {
				userConfs.set(canonAddr, { apps: [ folder ], mockConf: mockConf });
			}
		});
	});
}

if (process.argv.indexOf('--devtools') > 0) {
	const toolsMod = require('../ui/devtools');
	toolsMod.addDevToolsShortcuts();
}

registerAllProtocolShemas();

const users = new Set<{ init: InitProc; core: Core; }>();

(global as any).getW3N = function(webContent: Electron.WebContents) {
	for (const u of users) {
		const w3n = u.init.getRemotedW3N(webContent);
		if (w3n) { return w3n; }
	}
	return;
};

app.once('ready', async () => {

	for (const user of userConfs) {
		const init = new InitProc();
		const core = new Core(user[1].mockConf, bind(init, init.openViewer));
		await core.initFor(user[0]);
		for (const appDomainOrPath of user[1].apps) {
			if (appsFromFolders.length === 0) {
				// XXX this should be gone
				await init.openInbuiltApp(appDomainOrPath, core.makeCAPs);
			} else {
				await init.openAppInFolder(appDomainOrPath, core.makeCAPs);
			}
		}

		users.add({ init, core });
	}

});

app.on('window-all-closed', () => {
	app.quit();
});

recordUnhandledRejectionsInProcess();
