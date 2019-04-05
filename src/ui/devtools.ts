/*
 Copyright (C) 2017, 2019 3NSoft Inc.
 
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

import { BrowserWindow } from 'electron';
import * as shorts from 'electron-localshortcut';

const openedDevTools = new WeakSet<BrowserWindow>();

function devTools(): void {
	const win = BrowserWindow.getFocusedWindow();
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

function refresh(): void {
	const win = BrowserWindow.getFocusedWindow();
	win.webContents.reloadIgnoringCache();
}

const isMacOS = process.platform === 'darwin';

export function addDevToolsShortcuts(): void {
	shorts.register(isMacOS ? 'Cmd+Alt+I' : 'Ctrl+Shift+I', devTools);
	shorts.register('F12', devTools);
	shorts.register('CmdOrCtrl+R', refresh);
	shorts.register('F5', refresh);
}

const chromeDevTools = 'chrome-devtools://';
const chromeExtensions = 'chrome-extension://';
export function devToolsExtFilter(url: string): boolean {
	return (url.startsWith(chromeDevTools) || url.startsWith(chromeExtensions));
}

Object.freeze(exports);