/*
 Copyright (C) 2015 - 2016 3NSoft Inc.

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

/**
 * This module provides app-files functionality, acting as a front side for
 * app-files reliance set.
 */

import { DeviceFS, FS } from './device-fs';
import { stat, mkdir } from '../../lib-common/async-fs-node';
import { utf8, base64urlSafe } from '../../lib-common/buffer-utils';
import { FileException } from '../../lib-common/exceptions/file';
import { errWithCause } from '../../lib-common/exceptions/error';

function userIdToFolderName(userId: string): string {
	return base64urlSafe.pack(utf8.pack(userId));
}

function folderNameToUserId(folderName: string): string {
	return utf8.open(base64urlSafe.open(folderName));
}

const DEFAULT_APP_DIR = '3NWeb';
const UTIL_DIR = 'util';
const INBOX_DIR = 'inbox';
const STORAGE_DIR = 'storage';

const appDir = (() => {
	for (let arg of process.argv) {
		if (arg.startsWith('--data-dir=')) {
			let d = arg.substring(11);
			return (d.startsWith('"') ? d.substring(1, d.length-1) : d);
		}
	}
	return DEFAULT_APP_DIR;
})();

async function appFS(): Promise<FS> {
	await stat(appDir).catch(async (e: FileException) => {
		if (!e.notFound) { throw e; }
		await mkdir(appDir).catch((e: FileException) => {
			if (e.alreadyExists) { return; }
			throw errWithCause(e, `Cannot create app folder on the disk`);
		});
	});
	return DeviceFS.make(appDir);
}

export async function getUsersOnDisk(): Promise<string[]> {
	let rootFS = await appFS();
	let lst = await rootFS.listFolder('');
	let users: string[] = [];
	for (let entry of lst) {
		if (!entry.isFolder || (entry.name === UTIL_DIR)) { continue; }
		try {
			users.push(folderNameToUserId(entry.name));
		} catch (e) { continue; }
	}
	return users;
}

export async function getUtilFS(): Promise<FS> {
	return (await appFS()).writableSubRoot(UTIL_DIR);
}

export async function getInUserFS(user: string, path: string): Promise<FS> {
	return (await appFS()).writableSubRoot(
		userIdToFolderName(user)+'/'+path);
}

export function makeStorageFS(user: string): Promise<FS> {
	return getInUserFS(user, STORAGE_DIR);
}

export function makeInboxFS(user: string): Promise<FS> {
	return getInUserFS(user, INBOX_DIR);
}

Object.freeze(exports);