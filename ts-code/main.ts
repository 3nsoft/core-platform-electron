/*
 Copyright (C) 2016 - 2021 3NSoft Inc.
 
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

/**
 * This is main script, which electron framework starts.
 */

import { app, dialog, Menu } from 'electron';
import { InitProc } from './app-init/init-proc';
import { STARTUP_APP_DOMAIN } from './app-init/app-settings';
import { registerAllProtocolShemas } from "./electron/protocols";
import { fromEvent } from 'rxjs';
import { appDir, DEFAULT_SIGNUP_URL, logError, recordUnhandledRejectionsInProcess } from './confs';
import { take, mergeMap } from 'rxjs/operators';
import { getSkipAppErrorDialogFlag, getMultiInstanceFlag, getDevToolFlag, getSignUpUrlFromArg, getDataArg, MULTI_INSTANCE_FLAG, DATA_ARG, getDevAppsFromArgs } from './process-args';
import { makeCoreDriver } from './core/core-driver';
import { CoreConf } from 'core-3nweb-client-lib';

const multiInstance = getMultiInstanceFlag();
if (multiInstance) {
	if (!getDataArg()) {
		console.log(`Argument ${MULTI_INSTANCE_FLAG} requires presence of argument ${DATA_ARG}path`);
		process.exit(1);
	}
} else {
	const isFstInstance = app.requestSingleInstanceLock();
	if (!isFstInstance) {
		app.quit();
	} else {
		app.on('second-instance', async (event, argv, workDir) => {
			// note: currently we don't respond to argv in a second invokation
			await init.openAppMenuApp();
		});
	}
}

const conf: CoreConf = {
	signUpUrl: getSignUpUrlFromArg(DEFAULT_SIGNUP_URL),
	dataDir: appDir
}

registerAllProtocolShemas();

const init = new InitProc(
	makeCoreDriver, conf, getDevAppsFromArgs(), getDevToolFlag()
);

// Removing default menu
Menu.setApplicationMenu(null);

// Opening process
fromEvent(app, 'ready')
.pipe(
	take(1),
	mergeMap(async () => {
		// open startup app, that initializes core, based on user inputs
		const { coreInit } = await init.openStartupApp();
		await coreInit;
		process.on('SIGINT', () => init.exit(0));
		process.on('SIGTERM', () => init.exit(0));
	}),
	mergeMap(async () => {

		// Prevent closing when all windows are closed by setting listener
		app.on('window-all-closed', () => {});

		// open app menu as main ui
		await init.openAppMenuApp();

		// close startup window
		const startupApp = init.findOpenedApp(STARTUP_APP_DOMAIN);
		if (startupApp) {
			startupApp.window.close();
		}
	})
)
.subscribe({
	next: async () => {
		// open other ui elements, asynchronously
		(async () => {
			try {
				await init.createTray();
			} catch (err) {
				await logError(err);
			}
		})();
	},
	error: async err => {
		await logError(err);
		if (!getSkipAppErrorDialogFlag()) {
			dialog.showErrorBox(
				`Restart 3NWeb application`,
				`Error occured on 3NWeb core's initialization. Please restart application.`);
		}
		await init.exit(1);
	}
});

recordUnhandledRejectionsInProcess();
