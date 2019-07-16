/*
 Copyright (C) 2019 3NSoft Inc.
 
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

import { app, Event, WebContents, webContents } from 'electron';
import { InitProc } from '../../ui/init-proc';

const globalGetW3N = 'getW3N';

export function addFilteringOfRemote(
	isTopLevelWebContent: InitProc['isTopLevelWebContent']
): void {

	const topWebContsUsedW3N = new WeakSet<WebContents>();

	function allowConditionally(
		event: Event, webContent: WebContents
	): boolean {
		if (!isTopLevelWebContent(webContent)) {
			event.preventDefault();
			console.warn(`Prevented event on remote from a non-top webContent`);
			return false;
		}
		if (topWebContsUsedW3N.has(webContent)) {
			event.preventDefault();
			console.warn(`Prevented event on remote from a top webContent with w3n set`);
			return false;
		} else {
			console.warn(`Allowing event on remote from a top webContent without w3n set`);
			return true;
		}
	}

	function prevent(event: Event): void {
		event.preventDefault();
		console.warn(`Prevented event in filtering of remote`);
	}
	
	// XXX allow calls before w3n is setup in webContent, cause preload does 'em?
	// Preload also requires non-inbuilt script w3n, and other via it, but
	// not via remote.
	app.on('remote-get-builtin', allowConditionally);
	app.on('remote-get-current-web-contents', allowConditionally);

	app.on('remote-get-global', (event, webContents, globalName) => {
		if (!allowConditionally(event, webContents)) { return; }
		if (globalName === globalGetW3N) {
			// This is a timeout hack, cause an app get's touched somehow from
			// remote, probably by an internal function that sets remote.
			// Let's pause and observe the depth of statement that filtering in
			// such situations isn't trivial, and that getting rid of remote is
			// the most reliable action.
			setTimeout(() => topWebContsUsedW3N.add(webContents), 500);
		} else {
			event.preventDefault();
			console.warn(`Prevented getting global ${globalName} on remote`);
		}
	});

	app.on('remote-require', allowConditionally);
	app.on('remote-get-current-window', prevent);
	app.on('remote-get-guest-web-contents', prevent);

}


Object.freeze(exports);