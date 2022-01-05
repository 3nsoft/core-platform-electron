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

import { TestStandConfig } from "./test-stand";
import { readFileSync } from "fs";
import { Code } from "./lib-common/exceptions/file";
import { errWithCause } from "./lib-common/exceptions/error";
import { isAbsolute, resolve } from "path";
import { assert } from "./lib-common/assert";

export const DATA_ARG = '--data-dir=';
export const SIGNUP_URL_ARG = '--signup-url=';
export const MULTI_INSTANCE_FLAG = '--allow-multi-instances';
export const USER_DATA_MNT_ARG = '--user-data-mnt';
export const DEV_TOOL_FLAG = '--devtools';
export const HTTP_LOGGING_TO_CONSOLE_FLAG = '--console-log-http';
export const SKIP_APP_ERR_DIALOG_ARG = '--skip-app-error-dialog';
export const TEST_STAND_ARG = '--test-stand=';

export function getDataArg(): string|undefined {
	const arg = process.argv.find(arg => arg.startsWith(DATA_ARG));
	if (!arg) { return; }
	const d = arg.substring(DATA_ARG.length);
	return (d.startsWith('"') ? d.substring(1, d.length-1) : d);
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

export type DevToolsAppAllowance = (appDomain: string) => boolean;

export function devToolsFromARGs(): DevToolsAppAllowance {
	const allAllowedDevTools = process.argv.includes(DEV_TOOL_FLAG);
	return (appDomain: string) => {
		return allAllowedDevTools;
	};
}

type FileException = web3n.files.FileException;

export function testStandConfigFromARGs(): {
	conf: TestStandConfig; filePath: string;
}|undefined {
	const arg = process.argv.find(arg => arg.startsWith(TEST_STAND_ARG));
	if (!arg) { return; }
	const confPath = arg.substring(TEST_STAND_ARG.length);
	try {
		const filePath = (isAbsolute(confPath) ?
			confPath : resolve(process.cwd(), confPath));
		const str = readFileSync(filePath, { encoding: 'utf8' });
		const testStand = JSON.parse(str) as TestStandConfig;
		assert(
			typeof testStand === 'object',
			`Test stand configuration should be an object.`
		);	
		return { conf: testStand, filePath };
	} catch (err) {
		if ((err as FileException).code === Code.notFound) {
			return;
		} else {
			throw errWithCause(err, `Problem in reading file ${confPath} referenced by argument ${arg}`);
		}
	}
}


Object.freeze(exports);