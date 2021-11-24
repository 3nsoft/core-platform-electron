/*
 Copyright (C) 2017, 2019, 2021 3NSoft Inc.
 
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

import { BrowserWindow } from 'electron';
import * as shorts from 'electron-localshortcut';

const openedDevTools = new WeakSet<BrowserWindow>();

function devTools(win: BrowserWindow): void {
	if (win.webContents.devToolsWebContents) {
		win.webContents.devToolsWebContents.focus();
		return;
	} else if (openedDevTools.has(win)) {
		return;
	}
	const devtools = new BrowserWindow({
		webPreferences: {
			session: win.webContents.session
		}
	});
	win.webContents.setDevToolsWebContents(devtools.webContents);
	win.webContents.openDevTools({ mode: 'detach' });
	const closeDevTools = () => devtools.close();
	win.on('close', closeDevTools);
	devtools.on('close', () => win.removeListener('close', closeDevTools));
	openedDevTools.add(devtools);
}

function refresh(win: BrowserWindow): void {
	win.webContents.reloadIgnoringCache();
}

const isMacOS = process.platform === 'darwin';

export function addDevToolsShortcuts(win: BrowserWindow): void {
	const devToolKeys = [ 'F12', isMacOS ? 'Cmd+Alt+I' : 'Ctrl+Shift+I' ];
	const refreshKeys = [ 'F5', 'CmdOrCtrl+R' ];
	shorts.register(win, devToolKeys, () => devTools(win));
	shorts.register(win, refreshKeys, () => refresh(win));
}

const devToolsProto = 'devtools://';
const chromeDevTools = 'chrome-devtools://';
const chromeExtensions = 'chrome-extension://';
export function devToolsExtFilter(url: string): boolean {
	return (url.startsWith(devToolsProto) ||
		url.startsWith(chromeDevTools) ||
		url.startsWith(chromeExtensions));
}

const EXTENSION_NAMES: string[] = [
	'Vue.js', 'Angular', 'ng-inspector', 'Augury', 'Cycle.js'
];


Object.freeze(exports);