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

import { join } from 'path';
import { readFileSync, statSync } from 'fs';
import { AppManifest } from './app-settings';
import { errWithCause } from '../lib-common/exceptions/error';

export const APP_ROOT_FOLDER = 'app';
export const MANIFEST_FILE = 'manifest.json';

export function appCodeFolderIn(appDir: string): string {
	try {
		const app = join(appDir, APP_ROOT_FOLDER);
		const stats = statSync(app);
		if (!stats.isDirectory()) { throw new Error(
			`Path ${app} is not a directory with UI app code`); }
		return app;
	} catch (err) {
		throw errWithCause(err, `${appDir} doesn't seem to be a folder with UI app code and app manifest`);
	}
}

export function getManifestIn(appDir: string): AppManifest {
	try {
		const str = readFileSync(join(appDir, MANIFEST_FILE), { encoding: 'utf8' });
		const manifest = JSON.parse(str) as AppManifest;
		return manifest;
	} catch (err) {
		throw errWithCause(err, `Can't find or read ${MANIFEST_FILE} in ${appDir}`);
	}
}


Object.freeze(exports);