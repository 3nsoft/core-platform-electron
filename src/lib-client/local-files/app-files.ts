/*
 Copyright (C) 2015 - 2017 3NSoft Inc.

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

import { DeviceFS, WritableFS } from './device-fs';
import { stat, mkdir } from '../../lib-common/async-fs-node';
import { utf8, base64urlSafe } from '../../lib-common/buffer-utils';
import { FileException } from '../../lib-common/exceptions/file';
import { errWithCause } from '../../lib-common/exceptions/error';
import { join as joinPath } from 'path';

function userIdToFolderName(userId: string): string {
	return base64urlSafe.pack(utf8.pack(userId));
}

function folderNameToUserId(folderName: string): string {
	return utf8.open(base64urlSafe.open(folderName));
}

const UTIL_DIR = 'util';
const INBOX_DIR = 'inbox';
const STORAGE_DIR = 'storage';

const appDir = (() => {
	// either get value from parameters
	for (const arg of process.argv) {
		if (arg.startsWith('--data-dir=')) {
			const d = arg.substring(11);
			return (d.startsWith('"') ? d.substring(1, d.length-1) : d);
		}
	}
	// or generate default, based on platform version
	if (process.platform.startsWith('win')) {
		const parentFolder = process.env.LOCALAPPDATA;
		return (parentFolder ? joinPath(parentFolder, '3NWeb') : '3NWeb');
	} else {
		const parentFolder = process.env.HOME;
		return (parentFolder ? joinPath(parentFolder, '.3NWeb') : '.3NWeb');
	}
})();

async function appFS(): Promise<WritableFS> {
	await stat(appDir).catch(async (e: FileException) => {
		if (!e.notFound) { throw e; }
		await mkdir(appDir).catch((e: FileException) => {
			if (e.alreadyExists) { return; }
			throw errWithCause(e, `Cannot create app folder on the disk`);
		});
	});
	return DeviceFS.makeWritable(appDir);
}

export async function getUsersOnDisk(): Promise<string[]> {
	const rootFS = await appFS();
	const lst = await rootFS.listFolder('');
	const users: string[] = [];
	for (const entry of lst) {
		if (!entry.isFolder || (entry.name === UTIL_DIR)) { continue; }
		try {
			users.push(folderNameToUserId(entry.name));
		} catch (e) { continue; }
	}
	return users;
}

export function getCurrentAppVersion(): string {
	let packInfo;
	try {
		packInfo = require('../../package.json');
	} catch (err) {
		packInfo = require('../../../../package.json');
	}
	return packInfo.version;
}

export async function removeUsersIfAppVersionIncreases(): Promise<void> {
	const currVer = getCurrentAppVersion()
	.split('.')
	.map(s => parseInt(s));

	const utilFS = await getUtilFS();
	const versionFile = 'version.txt';
	
	try {
		const verOnDisk = (await utilFS.readTxtFile(versionFile)
		.catch((exc: web3n.files.FileException) => {
			if (exc.notFound) { return '0.0.0'; }
			throw exc;
		}))
		.split('.')
		.map(s => parseInt(s));
		
		let currentVerIsGreater = false;
		for (let i=0; i<3; i+=1) {
			if (currVer[i] > verOnDisk[i]) {
				currentVerIsGreater = true;
				break;
			}
		}
	
		if (!currentVerIsGreater) { return; }
	} catch (err) {
		console.error(err);
	}
	
	const mainFolder = await appFS();
	for (const f of (await mainFolder.listFolder('/'))) {
		if (f.isFolder && (f.name !== UTIL_DIR)) {
			await mainFolder.deleteFolder(f.name, true);
		}
	}
	await utilFS.writeTxtFile(versionFile, currVer.join('.'));
}

export async function getUtilFS(): Promise<WritableFS> {
	return (await appFS()).writableSubRoot(UTIL_DIR);
}

export async function getInUserFS(user: string, path: string):
		Promise<WritableFS> {
	return (await appFS()).writableSubRoot(
		userIdToFolderName(user)+'/'+path);
}

export function makeStorageFS(user: string): Promise<WritableFS> {
	return getInUserFS(user, STORAGE_DIR);
}

export function makeInboxFS(user: string): Promise<WritableFS> {
	return getInUserFS(user, INBOX_DIR);
}

Object.freeze(exports);