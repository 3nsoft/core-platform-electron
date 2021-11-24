/*
 Copyright (C) 2015 - 2018, 2020 - 2021 3NSoft Inc.

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

import { join } from 'path';
import { getDataArg } from './process-args';
import { homedir } from 'os';
import { appDirs, makeLogger } from 'core-3nweb-client-lib';

export const DEFAULT_SIGNUP_URL = 'https://3nweb.net/signup/';

const DATA_DIR = '.3NWeb';
const DATA_DIR_ON_WIN = '3NWeb';

export const UTIL_DIR = 'util';

export const appDir = (() => {
	// either get value from parameters
	const dataDir = getDataArg();
	if (dataDir !== undefined) { return dataDir }
	// or generate default, based on platform version
	if (process.platform === 'win32') {
		const parentFolder = (process.env.PORTABLE_EXECUTABLE_DIR ?
			process.env.PORTABLE_EXECUTABLE_DIR :
			process.env.LOCALAPPDATA);
		return (parentFolder ?
			join(parentFolder, DATA_DIR_ON_WIN) :
			join(homedir(), DATA_DIR_ON_WIN));
	} else {
		return join(homedir(), DATA_DIR);
	}
})();

export const utilDir = appDirs(appDir).getUtilFS();

export const {
	appLog, logError, logWarning, recordUnhandledRejectionsInProcess
} = makeLogger(utilDir);


export interface PackingInfo extends web3n.ui.PackVariant {
	platform: web3n.ui.PlatformType;
}

const PACKING_INFO_FNAME = 'packing-info.json';

// Packing info is placed into prepackaged folder into app.asar.unpacked.
// To get it out, we need to mangle current path, and if this wasn't packed,
// like in code-test cycle, we return undefined values instead of throwing.

function asarPathToUnpackedAsar(p: string): string|undefined {
	const ind = p.indexOf('app.asar');
	return ((ind >= 0) ?
		`${p.substring(0, ind+8)}.unpacked${p.substring(ind+8)}` : undefined
	);
}

export function findPackInfo(): PackingInfo|undefined {
	const pathToUnpacked = asarPathToUnpackedAsar(__dirname);
	if (!pathToUnpacked) { return; }
	const infoFile = join(pathToUnpacked, PACKING_INFO_FNAME);
	try {
		return require(infoFile);
	} catch (err) {
		return;
	}
}


Object.freeze(exports);