/*
 Copyright (C) 2015 - 2018 3NSoft Inc.

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

import { DeviceFS } from './device-fs';
import { stat, mkdir } from '../../lib-common/async-fs-node';
import { utf8, base64urlSafe } from '../../lib-common/buffer-utils';
import { FileException } from '../../lib-common/exceptions/file';
import { errWithCause } from '../../lib-common/exceptions/error';
import { join as joinPath } from 'path';

type ReadonlyFS = web3n.files.ReadonlyFS;
type WritableFS = web3n.files.WritableFS;

function userIdToFolderName(userId: string): string {
	return base64urlSafe.pack(utf8.pack(userId));
}

function folderNameToUserId(folderName: string): string {
	return utf8.open(base64urlSafe.open(folderName));
}

const UTIL_DIR = 'util';
const INBOX_DIR = 'inbox';
const STORAGE_DIR = 'storage';

const VERSION_FILE = 'version.txt';

export const DATA_ARG_NAME = '--data-dir';

export function getDataArgFrom(argv: string[]): string|undefined {
	for (const arg of argv) {
		if (!arg.startsWith(`${DATA_ARG_NAME}=`)) { continue; }
		const d = arg.substring(11);
		return (d.startsWith('"') ? d.substring(1, d.length-1) : d);
	}
	return;
}

const appDir = (() => {
	// either get value from parameters
	const dataDir = getDataArgFrom(process.argv);
	if (dataDir !== undefined) { return dataDir }
	// or generate default, based on platform version
	if (process.platform.startsWith('win')) {
		const parentFolder = (process.env.PORTABLE_EXECUTABLE_DIR ?
			process.env.PORTABLE_EXECUTABLE_DIR :
			process.env.LOCALAPPDATA);
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
	return DeviceFS.makeWritableFS(appDir);
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

export function getCurrentAppVersion(): number[] {
	let packInfo;
	try {
		packInfo = require('../../package.json');
	} catch (err) {
		packInfo = require('../../../../package.json');
	}
	return packInfo.version.split('.').map(s => parseInt(s));
}

async function readAppVersionFromFile(utilFS: ReadonlyFS): Promise<number[]> {
	return (await utilFS.readTxtFile(VERSION_FILE)
	.catch((exc: web3n.files.FileException) => {
		if (exc.notFound) { return '0.0.0'; }
		throw exc;
	}))
	.split('.')
	.map(s => parseInt(s));
}

async function writeAppVersionToFile(utilFS: WritableFS, v: number[]):
		Promise<void> {
	await utilFS.writeTxtFile(VERSION_FILE, v.join('.'));
}

function compareVersions(v1: number[], v2: number[]): number {
	for (let i=0; i<3; i+=1) {
		const delta = v1[i] - v2[i];
		if (delta === 0) { continue; }
		else if (delta > 0) { return 1; }
		else if (delta < 0) { return -1; }
	}
	return 0;
}

export async function changeCacheDataOnAppVersionUpdate(): Promise<void> {
	const utilFS = await getUtilFS();
	try {
		const verOnDisk = await readAppVersionFromFile(utilFS);
		
		if (compareVersions(verOnDisk, [0,8,0]) < 0) {
			// remove all users' cache folders
			const mainFolder = await appFS();
			for (const f of (await mainFolder.listFolder('/'))) {
				if (f.isFolder && (f.name !== UTIL_DIR)) {
					await mainFolder.deleteFolder(f.name, true);
				}
			}
		}

		if (compareVersions(getCurrentAppVersion(), verOnDisk) > 0) {
			await writeAppVersionToFile(utilFS, getCurrentAppVersion());
		}

	} catch (err) {
		console.error(err);
	}

}

export async function getUtilFS(): Promise<WritableFS> {
	return (await appFS()).writableSubRoot(UTIL_DIR);
}

async function getInUserFS(user: string, path: string):
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