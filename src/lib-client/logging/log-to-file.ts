/*
 Copyright (C) 2017 - 2019 3NSoft Inc.

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

import { getUtilFS, getCurrentAppVersion } from '../local-files/app-files';
import { utf8 } from '../../lib-common/buffer-utils';
import { stringifyErr } from '../../lib-common/exceptions/error';
import { SingleProc } from '../../lib-common/processes';

const LOGS_FOLDER = 'logs';

export async function logError(err: any, msg?: string): Promise<void> {
	try {
		const now = new Date();
		const entry = `
${now} ==================================
App version ${getCurrentAppVersion().join('.')}
Log level: error.${msg ? `
${msg}` : ''}
${stringifyErr(err)}`;
		await appendLog(entry, now);
	} catch (err2) {
		console.error(err);
		console.error(err2);
	}
}

const loggingProc = new SingleProc();

function appendLog(s: string, now: Date, appDomain?: string): Promise<void> {
	return loggingProc.startOrChain(async () => {
		const utilFolder = await getUtilFS();
		const logFile = `${LOGS_FOLDER}/${logFileName(now, appDomain)}`;
		const sink = await utilFolder.getByteSink(logFile, true);
		const size = await sink.getSize();
		await sink.seek!(size!);
		sink.write(utf8.pack(s));
	});
}

function logFileName(now: Date, appDomain?: string): string {
	const dateStr = now.toISOString().slice(0, 10);
	return (appDomain ?
		`${dateStr}.${appDomain}.log.txt` :
		`${dateStr}.log.txt`);
}

export async function logWarning(msg: string, err?: any): Promise<void> {
	try {
		const now = new Date();
		const entry = `
${now} ==================================
App version ${getCurrentAppVersion().join('.')}
Log level: warning.
${msg}
${err ? stringifyErr(err) : ''}`;
		await appendLog(entry, now);
	} catch (err2) {
		console.warn(msg);
		if (err) {
			console.warn(err);
		}
		console.error(err2);
	}
}

export async function appLog(type: 'error'|'info'|'warning', appDomain: string,
		msg: string, err?: any): Promise<void> {
	try {
		const now = new Date();
		const entry = `
${now} ==================================
App ${appDomain}, running on core version ${getCurrentAppVersion().join('.')}
Log level: ${type}.${msg ? `
${msg}` : ''}
${stringifyErr(err)}`;
		await appendLog(entry, now, appDomain);
	} catch (err2) {
		console.error(err2);
	}

}

export function recordUnhandledRejectionsInProcess(): void {
	const unhandledRejections = new WeakMap();
	process.on('unhandledRejection', async (reason, p) => {
		unhandledRejections.set(p, reason);
		await logError(reason, 'Unhandled exception');
	});
	process.on('rejectionHandled', async (p) => {
		const reason = unhandledRejections.get(p);
		await logWarning('Handling previously unhandled rejection', reason);
		unhandledRejections.delete(p);
	});
}


Object.freeze(exports);