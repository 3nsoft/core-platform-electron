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
import { AppManifest } from '../ui/app-settings';
import { appCodeFolderIn, getManifestIn } from '../ui/load-utils';
import { errWithCause } from '../lib-common/exceptions/error';
import { CAPs } from '../main/core';
import { makeForMockWithAppCodeFromUrl } from '../lib-client/electron/session';
import { loadUserExtensions } from '../ui/devtools';

function printUsage(out: typeof console.log): void {
	out(`
Usage:
	...${sep}3nweb --app-dir=app1 [--app-dir=app2 ...] [--data-dir=data_folder] [--devtools]
Options:
	--app-dir=folder - this option must be present with folder for at least one app, that is to be opened. Value can either be --app-dir=path, or a tuple
	"--app-dir=http-url|path" with |-separator, that needes outside quotes.
	Http url option allows one to display code that is watched and instantly
	http-served by common frameworks.
	--data-dir=folder - tells which folder to use for data.
	--devtools - allows to open chrome dev tools with common shortcuts like <Ctrl+Shift+I>, and adds refreshing with <Ctrl+R>.
`);
}

const MOCK_CONF_FILE = 'mock-conf.json';

function getMockConfIn(appDir: string): MockConfig {
	try {
		const str = readFileSync(join(appDir, MOCK_CONF_FILE), { encoding: 'utf8' });
		const mockConf = JSON.parse(str) as MockConfig;
		validateConfs(mockConf);
		return mockConf;
	} catch (err) {
		throw errWithCause(err, `Can't find or read ${MOCK_CONF_FILE} in ${appDir}`);
	}
}

function extractHttpRootAndAppDirFromArg(arg: string):
		{ rootHttp?: string; appDir: string; } {
	if (!arg.startsWith('http:')) {
		return { appDir: arg };
	}
	const indOfSep = arg.indexOf('|');
	if (indOfSep < 0) { throw new Error(
		`Missing separator character '|' in --app-dir argument`); }
	const rootHttp = arg.substring(0, indOfSep);
	const appDir = arg.substring(indOfSep + 1);
	return { appDir, rootHttp };
}

type AppParams = {
	rootHttp?: string;
	rootFolder?: string;
	manifest: AppManifest;
};

const appsFromFolders = process.argv
.filter(arg => arg.startsWith('--app-dir='))
.map(arg => arg.substring(10))
.map(extractHttpRootAndAppDirFromArg)
.map(({ appDir, rootHttp }) => {
	try {
		const appParams: AppParams = { manifest: getManifestIn(appDir) };
		if (rootHttp) {
			appParams.rootHttp = rootHttp;
		} else {
			appParams.rootFolder = appCodeFolderIn(appDir);
		}
		const conf = getMockConfIn(appDir);
		return [appParams, conf];
	} catch (exc) {
		console.error(`Can't read mock configuration file in folder ${appDir}`);
		console.error(exc);
		return;
	}
})
.filter(conf => !!conf) as [AppParams, MockConfig][];

const userConfs = new Map<string, {
	apps?: AppParams[];
	appDomains?: string[];
	mockConf: MockConfig;
}>();

if (appsFromFolders.length === 0) {
	// XXX this should be gone with removal of run-mock gulp task
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
					if (!uConfs.appDomains!.includes(appDomain)) {
						uConfs.appDomains!.push(appDomain);
					}
				} else {
					userConfs.set(canonAddr, { appDomains: [ appDomain ], mockConf });
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
	.forEach(([ app, mockConf ]) => {
		mockConf.users
		.map(userIndex => mockConf.mail.existingUsers[userIndex].address)
		.map(toCanonicalAddress)
		.forEach(canonAddr => {
			let uConfs = userConfs.get(canonAddr);
			if (uConfs) {
				// XXX we may also add here merging of mockConf's for the same user
				const appAlreadyPresent = !!uConfs.apps!.find(
					p => (p.manifest.appDomain === app.manifest.appDomain));
				if (!appAlreadyPresent) {
					uConfs.apps!.push(app);
				}
			} else {
				userConfs.set(canonAddr, { apps: [ app ], mockConf: mockConf });
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

async function loadAndOpenAppFromUrl(init: InitProc,
		url: string, manifest: AppManifest, caps: CAPs): Promise<void> {
	try {
		const mockSession = makeForMockWithAppCodeFromUrl(url);
		const appInstance = await init.openApp(
			manifest.appDomain, url, caps,
			mockSession, manifest.windowOpts);
		if (manifest.content) {
			if (!url.endsWith('/') && !manifest.content.startsWith('/')) {
				url += '/';
			}
			url += manifest.content;
		}
		appInstance.window.loadURL(url);
	} catch (err) {
		throw errWithCause(err, `Cannot open app in mock from url ${url}`);
	}

}

app.once('ready', async () => {

	if (process.argv.indexOf('--devtools') > 0) {
		await loadUserExtensions().catch(err => console.error(err));
	}
	
	for (const user of userConfs) {
		const init = new InitProc();
		const core = new Core(user[1].mockConf, bind(init, init.openViewer));
		await core.initFor(user[0]);
		if (user[1].apps) {
			for (const app of user[1].apps!) {
				const caps = core.makeCAPs(app.manifest.appDomain, app.manifest);
				if (app.rootFolder) {
					await init.openAppInFolder(app.rootFolder, app.manifest, caps);
				} else if (app.rootHttp) {
					await loadAndOpenAppFromUrl(
						init, app.rootHttp, app.manifest, caps);
				} else {
					throw new Error(`Missing both http and path root for app code`);
				}
			}
		} else if (user[1].appDomains) {
			// XXX this should be gone with removal of run-mock gulp task
			for (const appDomain of user[1].appDomains!) {
				await init.openInbuiltApp(appDomain, core.makeCAPs);
			}
		} else {
			throw new Error(`Missing both app params and app domains`);
		}

		users.add({ init, core });
	}

});

app.on('window-all-closed', () => {
	app.quit();
});

recordUnhandledRejectionsInProcess();
