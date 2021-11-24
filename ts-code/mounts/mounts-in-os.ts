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

import { FSMount } from './fuse-mount/fs-mount';
import { FactoryOfFSs } from 'core-3nweb-client-lib';
import { getUserDataMntArg } from '../process-args';
import { mkdir } from '../lib-common/async-fs-node';
import { join } from 'path';
import { homedir } from 'os';
import { logError } from '../confs';
import { assert } from '../lib-common/assert';

const DEFAULT_WIN_MNT = 'W:';
const DEFAULT_MNT = '3NWeb storage';

export async function prepareUserDataMntPath(): Promise<string|undefined> {
	if (process.env.PORTABLE_EXECUTABLE_DIR) { return; }
	
	const path = getUserDataMntArg();
	
	if (path) {
		if (path === 'no') { return; }
		if (process.platform === 'win32') { return path; }
		await ensureDirPresence(path);
		return path;
	}

	if (process.platform === 'win32') { return DEFAULT_WIN_MNT; }

	const defaultPath = join(homedir(), DEFAULT_MNT);
	await ensureDirPresence(defaultPath);
	return defaultPath;
}

export async function prepareDebugAppsDataMntPaths(): Promise<{
	syncedStore: string; localStore: string;
}|undefined> {
	if (process.env.PORTABLE_EXECUTABLE_DIR) { return; }

	if (process.platform === 'win32') { return; }

	const syncedStore = join(homedir(), '3NWeb synced apps data');
	await ensureDirPresence(syncedStore);
	const localStore = join(homedir(), '3NWeb local apps data');
	await ensureDirPresence(localStore);
	return { syncedStore, localStore };
}

async function ensureDirPresence(path: string): Promise<void> {
	await mkdir(path).catch(async (exc: FileException) => {
		if (exc.alreadyExists) { return; }
		else { throw exc; }
	});
}

type FileException = web3n.files.FileException;
type FS = web3n.files.FS;
type WritableFS = web3n.files.WritableFS;
type File = web3n.files.File;
type FSCollection = web3n.files.FSCollection;
type StorageType = web3n.storage.StorageType;
type StorageUse = web3n.storage.StorageUse;


export class MountsInOS {

	private readonly mounts = new Set<FSMount>();

	constructor(
		private storages: FactoryOfFSs
	) {
		Object.seal(this);
	}

	async mountInTmp(f: FS|File): Promise<string> {

		// XXX this should be a mount into temporary, or, access FSMount

		throw new Error('Mounting of storage items is not implemented, yet.');
	}

	async mountStorageFolderInOS(
		store: StorageUse, type: StorageType, storePath: string, mntPath: string
	): Promise<void> {
		if (findIn(this.mounts, m => (m.mntPath === mntPath))) { return; }

		if ((type !== 'synced') && (type !== 'local')) {
			throw new Error(`Don't mount to OS storage type ${type}`);
		}

		let fs: FS;
		if (store === 'user') {
			const item = await this.storages.getUserFS(type);
			assert(!!item.isFolder);
			fs = item.item as FS;
			if ((storePath !== '') && (storePath !== '/') && (storePath !== '.')) {
				if (fs.writable) {
					fs = await (fs as WritableFS).writableSubRoot(storePath);
				} else {
					fs = await fs.readonlySubRoot(storePath);
				}
			}
		} else if (store === 'system') {
			const items = await this.storages.getSysFSs(type);
			// XXX Should fsMount be able to mount collection
			assert(!!items.isCollection);
			// XXX use of storePath isn't perfect
			const item = await (items.item as FSCollection).get(storePath);
			if (!item) { throw new Error(`Can't find ${storePath} in system ${type} collection. But this is a simple code, that doesn't understand path with many sections. Is it like it?`); }
			assert(!!item.isFolder);
			fs = item.item as FS;
		} else {
			throw new Error(`Don't mount to OS storage of ${store}`);
		}

		const fsMount = await FSMount.mountSingleFS(mntPath, fs);
		this.mounts.add(fsMount);
	}

	async mountFolderinOS(folder: FS, mntPath: string): Promise<void> {
		const fsMount = await FSMount.mountSingleFS(mntPath, folder);
		this.mounts.add(fsMount);
	}

	async unmount(mntPath: string): Promise<void> {
		const mount = findIn(this.mounts, m => (m.mntPath === mntPath));
		if (mount) {
			await mount.unmount();
		}
	}

	async close(): Promise<void> {
		const mounts = Array.from(this.mounts);
		this.mounts.clear();
		await Promise.all(mounts.map(fsMount =>
			fsMount.unmount().catch(exc => logError(exc,
				`On closing, can't unmount user storage from ${fsMount.mntPath}`)))
		);
	}

}
Object.freeze(MountsInOS.prototype);
Object.freeze(MountsInOS);


function findIn<T>(s: Set<T>, predicate: (v: T) => boolean): T|undefined {
	for (const v of s) {
		if (predicate(v)) { return v; }
	}
	return;	// explicit undefined
}


Object.freeze(exports);