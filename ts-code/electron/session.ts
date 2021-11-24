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

import { session, Session } from 'electron';
import { setAppProtocolIn, protoSchemas, setFsProtocolIn } from "./protocols";
import { logWarning } from '../confs';
import { devToolsExtFilter } from '../app-init/devtools';

type FS = web3n.files.FS;

export function makeSessionForApp(
	appDomain: string, appFilesRoot: FS, devTools: boolean
): Session {
	if (!appDomain) { throw new Error(`Bad app domain given: ${appDomain}`); }
	const appSes = generateSession(devTools);

	setAppProtocolIn(appSes, appFilesRoot, appDomain);

	const allowUrl = makeUrlChecker(
		`${protoSchemas.W3N_APP.scheme}://${appDomain}`,
		devTools);

	appSes.webRequest.onBeforeRequest((details, cb) => {
		if (allowUrl(details.url)) {
			cb({ cancel: false });
		} else {
			logWarning(`Canceled unexpected ${details.method} request for ${details.url}`);
			cb({ cancel: true });
		}
	});
	
	return appSes;
}

let partitionCounter = Date.now();
function generateSession(devTools: boolean): Session {
	partitionCounter += 1;
	if (partitionCounter === Number.MAX_SAFE_INTEGER) {
		partitionCounter = Number.MAX_SAFE_INTEGER;
	}
	const partition = (devTools ?
		`persist:s${partitionCounter}` :
		`s${partitionCounter}`);
	return session.fromPartition(partition, { cache: false });
}

export function makeSessionFor3NComms(): Session {
	const commSes = generateSession(false);
	
	// XXX should we added anything else here?

	return commSes;
}

export function makeSessionForViewer(
	fs: FS, path: string, itemType: 'file'|'folder', devTools: boolean
): Session {
	const viewSes = generateSession(devTools);

	setFsProtocolIn(viewSes, fs, path, itemType);

	const allowUrl = makeUrlChecker(
		`${protoSchemas.W3N_FS.scheme}://${itemType}`,
		devTools);

	viewSes.webRequest.onBeforeRequest((details, cb) => {
		if (allowUrl(details.url)) {
			cb({ cancel: false });
		} else {
			logWarning(`Canceled unexpected ${details.method} request for ${details.url}`);
			cb({ cancel: true });
		}
	});
	
	return viewSes;
}

function makeUrlChecker(
	appUrlStart: string, devTools: boolean
): (url: string) => boolean {
	if (devTools)  {
		return url => (url.startsWith(appUrlStart) || devToolsExtFilter(url));
	} else {
		return url => url.startsWith(appUrlStart);
	}
}

export function makeSessionForDevAppFromUrl(url: string): Electron.Session {
	const appSes = generateSession(true);

	// XXX there are absolutely no restrictions here.
	// Should we tighten this? Or should devs do further testing with folder
	// based load to feed out requests that won't run in production?

	return appSes;
}


Object.freeze(exports);