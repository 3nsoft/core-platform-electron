/*
 Copyright (C) 2017 3NSoft Inc.
 
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

import installExtension, { VUEJS_DEVTOOLS, ANGULARJS_BATARANG }
	from 'electron-devtools-installer';
import { BrowserWindow } from 'electron';

export async function addDevExtensions(): Promise<void> {
	await installExtension(VUEJS_DEVTOOLS).catch(err => console.error(err));
	await installExtension(ANGULARJS_BATARANG).catch(err => console.error(err));
}

export function removeDevExtensions(): void {
	const exts = BrowserWindow.getDevToolsExtensions();
	for (const extName of Object.keys(exts)) {
		BrowserWindow.removeDevToolsExtension(extName);
	}
}

const chromeDevTools = 'chrome-devtools://';
const chromeExtensions = 'chrome-extension://';
export function devToolsExtFilter(url: string): boolean {
	return (url.startsWith(chromeDevTools) || url.startsWith(chromeExtensions));
}

Object.freeze(exports);