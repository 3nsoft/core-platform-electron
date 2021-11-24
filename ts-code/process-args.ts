/*
 Copyright (C) 2018, 2020 - 2021 3NSoft Inc.

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

import { appCodeFolderIn } from "./app-init/load-utils";
import { AppManifest } from "./app-init/app-settings";

export const DEV_APP_ARG = '--dev-app=';
export const DATA_ARG = '--data-dir=';
export const SIGNUP_URL_ARG = '--signup-url=';
export const MULTI_INSTANCE_FLAG = '--allow-multi-instances';
export const USER_DATA_MNT_ARG = '--user-data-mnt';
export const DEV_TOOL_FLAG = '--devtools';
export const HTTP_LOGGING_TO_CONSOLE_FLAG = '--console-log-http';
export const SKIP_APP_ERR_DIALOG_ARG = '--skip-app-error-dialog';

export function getDataArg(): string|undefined {
	const arg = process.argv.find(arg => arg.startsWith(DATA_ARG));
	if (!arg) { return; }
	const d = arg.substring(DATA_ARG.length);
	return (d.startsWith('"') ? d.substring(1, d.length-1) : d);
}

export function getDevToolFlag(): boolean {
	return process.argv.includes(DEV_TOOL_FLAG);
}

export function getHttpConsoleLoggingFlag(): boolean {
	return process.argv.includes(HTTP_LOGGING_TO_CONSOLE_FLAG);
}

export function getSignUpUrlFromArg(defaultUrl: string): string {
	const arg = process.argv.find(arg => arg.startsWith(SIGNUP_URL_ARG));
	return (arg ?
		`https://${arg.substring(SIGNUP_URL_ARG.length)}` : defaultUrl);
}

export function getMultiInstanceFlag(): boolean {
	return process.argv.includes(MULTI_INSTANCE_FLAG);
}

export function getSkipAppErrorDialogFlag(): boolean {
	return process.argv.includes(SKIP_APP_ERR_DIALOG_ARG);
}

// XXX mount options should move to storage disks app
export function getUserDataMntArg(): string|undefined {
	const arg = process.argv.find(arg => arg.startsWith(USER_DATA_MNT_ARG));
	if (!arg) { return; }
	const d = arg.substring(USER_DATA_MNT_ARG.length);
	return (d.startsWith('"') ? d.substring(1, d.length-1) : d);
}

export interface DevAppParams {
	rootUrl?: string;
	rootFolder?: string;
	manifest: AppManifest;
};

export function getDevAppsFromArgs(): DevAppParams[]|undefined {
	const appParams = process.argv
	.filter(arg => arg.startsWith(DEV_APP_ARG))
	.map(arg => arg.substring(10))
	.map(extractHttpRootAndAppDirFromArg)
	.map(({ appDir, rootUrl }) => {
		try {
			const { rootFolder, manifest } = appCodeFolderIn(appDir);
			return (rootUrl ? { rootUrl, manifest } : { rootFolder, manifest });
		} catch (exc) {
			console.error(exc);
		}
	})
	.filter(conf => !!conf) as DevAppParams[];
	return ((appParams.length === 0) ? undefined : appParams);
}

function extractHttpRootAndAppDirFromArg(
	arg: string
): { rootUrl?: string; appDir: string; } {
	const indOfSep = arg.indexOf('|');
	return ((indOfSep < 3) ?
		{ appDir: arg } :
		{
			rootUrl: arg.substring(0, indOfSep),
			appDir: arg.substring(indOfSep + 1)
		});
}


Object.freeze(exports);