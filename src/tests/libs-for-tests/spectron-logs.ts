/*
 Copyright (C) 2016 3NSoft Inc.
 
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

import { AppRunner } from './app-runner';

interface RendererLog {
	message: string;
	source: string;
	level: string;
}

export async function displayBrowserLogs(app: AppRunner): Promise<void> {
	let rendererLogs: RendererLog[] = await (<any> app.c).getRenderProcessLogs();
	let msg = '';
	for (let log of rendererLogs) {
		msg += `\n${(log.level === 'SEVERE' ? 'ERROR' : log.level)} > ${log.message}`;
	}
	if (msg.length > 0) {
		if (app.user) {
			msg = `\nRenderer logs for app with user ${app.user.userId}${msg}`;
		}
		console.log(msg);
	}
}

export async function displayStdOutLogs(app: AppRunner): Promise<void> {
	let stdLogs: string[] = await (<any> app.c).getMainProcessLogs();
	let msg = '';
	for (let log of stdLogs) {
		msg += `\n${log}`;
	}
	if (msg.length > 0) {
		if (app.user) {
			msg = `\nStdOut logs for app with user ${app.user.userId}${msg}`;
		}
		console.log(msg);
	}
}
