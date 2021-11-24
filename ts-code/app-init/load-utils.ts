/*
 Copyright (C) 2019, 2021 3NSoft Inc.
 
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
import { readFileSync, statSync } from 'fs';
import { AppManifest } from './app-settings';
import { errWithCause } from '../lib-common/exceptions/error';
import { assert } from '../lib-common/assert';
import { APP_ROOT_FOLDER, MANIFEST_FILE } from '../app-installer/unpack-zipped-app';

export function appCodeFolderIn(
	appDir: string
): { rootFolder: string; manifest: AppManifest; } {
	try {
		const rootFolder = join(appDir, APP_ROOT_FOLDER);
		const stats = statSync(rootFolder);
		if (!stats.isDirectory()) { throw new Error(
			`Path ${rootFolder} is not a directory with UI app code`); }
		const manifest = appManifestFrom(appDir);
		return { manifest, rootFolder };
	} catch (err) {
		throw errWithCause(err, `${appDir} doesn't seem to be a folder with UI app code and app manifest`);
	}
}

function appManifestFrom(appDir: string): AppManifest {
	try {
		const str = readFileSync(join(appDir, MANIFEST_FILE), { encoding: 'utf8' });
		const manifest = JSON.parse(str) as AppManifest;
		assert(typeof manifest.appDomain === 'string');
		return manifest;
	} catch (err) {
		throw errWithCause(err, `Can't find or read ${MANIFEST_FILE} in ${appDir}`);
	}
}


Object.freeze(exports);