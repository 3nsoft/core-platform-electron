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

/**
 * This is main script, which electron framework starts.
 */

import { app } from 'electron';
import { OpenWindows } from './ui/open-windows';
import { StartupWin } from './ui/startup';
import { Core } from './main/core';

const DEFAULT_SIGNUP_URL = 'https://3nweb.net/signup/';

let signupUrl: string = (undefined as any);
for (let arg of process.argv) {
	if (arg.startsWith('--signup-url=')) {
		signupUrl = `https://${arg.substring(13)}`;
		break;
	}
}

let openedWins = new OpenWindows();
let core = new Core(
	(signupUrl ? signupUrl : DEFAULT_SIGNUP_URL),
	switchAppsAfterInit);

let closeAppWhenNoWindows = true;
function switchAppsAfterInit() {
	closeAppWhenNoWindows = false;
	let startupWin = openedWins.getWin<StartupWin>(StartupWin.APP_NAME);
	startupWin.win.close();
	let clientWin = openedWins.openClientWin();
	core.attachServicesToClientApp(clientWin);
	clientWin.win.webContents.once('did-stop-loading', () => {
		closeAppWhenNoWindows = true;
	});
}

app.on('ready', () => {
	let w = openedWins.openStartupWin();
	core.initServicesWith(w.win);
});

app.on('window-all-closed', async () => {
	if (closeAppWhenNoWindows) {
		await core.close();
		app.quit();
	}
});
