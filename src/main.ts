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

/**
 * This is main script, which electron framework starts.
 */

import { app, dialog } from 'electron';
import { InitProc } from './ui/init-proc';
import { CLIENT_APP_DOMAIN, STARTUP_APP_DOMAIN } from './ui/app-settings';
import { Core } from './main/core';
import { registerAllProtocolShemas } from "./lib-client/electron/protocols";
import { logError, logWarning } from './lib-client/logging/log-to-file';
import { Observable } from 'rxjs';
import { bind } from './lib-common/binding';
import { removeUsersIfAppVersionIncreases } from './lib-client/local-files/app-files';

const DEFAULT_SIGNUP_URL = 'https://3nweb.net/signup/';

const signupUrl = (() => {
	const arg = process.argv.find(arg => arg.startsWith('--signup-url='));
	if (arg) { return `https://${arg.substring(13)}`; }
	else { return DEFAULT_SIGNUP_URL; }
})();

const devTools = (() => {
	if (process.argv.indexOf('--devtools') > 0) {
		const toolsMod = require('./ui/devtools');
		return {
			add: toolsMod.addDevExtensions.bind(toolsMod),
			remove: toolsMod.removeDevExtensions.bind(toolsMod)
		};
	}
})();

registerAllProtocolShemas();

(global as any).getW3N = function(webContent: Electron.WebContents) {
	return init.getRemotedW3N(webContent);
};

const init = new InitProc();
const core = new Core(bind(init, init.openViewer));

// Opening process
Observable.fromEvent<void>(app, 'ready')
.take(1)
.flatMap(removeUsersIfAppVersionIncreases)
.flatMap(async () => {
	// open startup app, that initializes core, based on user inputs
	if (devTools) { await devTools.add(); }
	const { caps, coreInit$ } = await core.start(signupUrl);
	await init.openStartupApp(caps);
	return coreInit$;
})
.flatMap(coreInit$ => coreInit$)
.flatMap(async () => {
	// open main window
	await init.openInbuiltApp(CLIENT_APP_DOMAIN, core.makeCAPs);

	// close startup window
	const startupApp = init.findOpenedApp(STARTUP_APP_DOMAIN);
	if (startupApp) {
		startupApp.window.close();
	}
})
.subscribe(undefined, async err => {
	await logError(err);
	dialog.showErrorBox(`Restart 3NWeb application`, `Error occured on 3NWeb core's initialization. Please restart application.`);
	await core.close();
});

// Closing process
Observable.fromEvent<void>(app, 'window-all-closed')
.flatMap(() => core.close(), 1)
.merge(core.close$)
.take(1)
.subscribe(() => {
	if (devTools) { devTools.remove(); }
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
