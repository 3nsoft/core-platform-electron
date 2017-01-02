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

/**
 * This module provides app-files functionality, acting as a front side for
 * app-files reliance set.
 */

import { DeviceFS, FS } from '../../lib-client/local-files/device-fs';
import { stat, mkdir } from '../../lib-common/async-fs-node';
import { utf8, base64urlSafe } from '../../lib-common/buffer-utils';
import { toCanonicalAddress } from '../../lib-common/canonical-address';
import { FileException } from '../../lib-common/exceptions/file';
import { errWithCause } from '../../lib-common/exceptions/error';

function userIdToFolderName(userId: string): string {
	userId = toCanonicalAddress(userId);
	return base64urlSafe.pack(utf8.pack(userId));
}

function folderNameToUserId(folderName: string): string {
	return utf8.open(base64urlSafe.open(folderName));
}

const APP_DIR = '3NWeb-mock';
const INBOX_DIR = 'inbox';
const STORAGE_DIR = 'storage';

async function appFS(): Promise<FS> {
	await stat(APP_DIR).catch(async (e: FileException) => {
		if (!e.notFound) { throw e; }
		await mkdir(APP_DIR).catch((e: FileException) => {
			if (e.alreadyExists) { return; }
			throw errWithCause(e, `Cannot create app folder on the disk`);
		});
	});
	return DeviceFS.make(APP_DIR);
}

export async function getInUserFS(user: string, path: string): Promise<FS> {
	return (await appFS()).writableSubRoot(userIdToFolderName(user)+'/'+path);
}

export function makeStorageFS(user: string): Promise<FS> {
	return getInUserFS(user, STORAGE_DIR);
}

export function makeInboxFS(user: string): Promise<FS> {
	return getInUserFS(user, INBOX_DIR);
}

Object.freeze(exports);