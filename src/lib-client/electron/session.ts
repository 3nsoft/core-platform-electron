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

import { session } from 'electron';
import { setAppProtocolIn, protoSchemas, setFsProtocolIn } from "./protocols";
import { logWarning } from '../logging/log-to-file';

const urlFilter = ((process.argv.indexOf('--devtools') > 0) ?
	require('../../ui/devtools').devToolsExtFilter : undefined);

type FS = web3n.files.FS;

export async function makeSessionForApp(appDomain: string,
		appFilesRoot: string|FS): Promise<Electron.Session> {
	if (!appDomain) { throw new Error(`Bad app domain given: ${appDomain}`); }
	const appSes = session.fromPartition(generatePartition(), { cache: false });

	await setAppProtocolIn(appSes, appFilesRoot, appDomain);

	const appUrlStart = `${protoSchemas.W3N_APP}://${appDomain}`;
	// current (electron 1.6.11) definition misses option with one argument
	(appSes.webRequest.onBeforeRequest as any)((details, cb) => {
		if (details.url.startsWith(appUrlStart)
		|| (urlFilter && urlFilter(details.url))) {
			cb({ cancel: false });
		} else {
			logWarning(`Canceled unexpected ${details.method} request for ${details.url}`);
			cb({ cancel: true });
		}
	});
	
	return appSes;
}

let partitionCounter = 0;
function generatePartition(): string {
	partitionCounter += 1;
	if (partitionCounter === Number.MAX_SAFE_INTEGER) {
		partitionCounter = Number.MAX_SAFE_INTEGER;
	}
	return `s${partitionCounter}`;
}

export function makeSessionFor3NComms(): Electron.Session {
	const commSes = session.fromPartition(generatePartition(), { cache: false });
	
	// XXX should we added anything else here?

	return commSes;
}

export async function makeSessionForViewer(fs: FS, path: string,
		itemType: 'file'|'folder'): Promise<Electron.Session> {
	const viewSes = session.fromPartition(generatePartition(), { cache: false });

	await setFsProtocolIn(viewSes, fs, path, itemType);

	const appUrlStart = `${protoSchemas.W3N_FS}://${itemType}`;
	// current (electron 1.6.11) definition misses option with one argument
	(viewSes.webRequest.onBeforeRequest as any)((details, cb) => {
		if (details.url.startsWith(appUrlStart)) {
			cb({ cancel: false });
		} else {
			logWarning(`Canceled unexpected ${details.method} request for ${details.url}`);
			cb({ cancel: true });
		}
	});
	
	return viewSes;
}

Object.freeze(exports);