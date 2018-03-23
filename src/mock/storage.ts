/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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

import { makeStorageFS } from './mock-files';
import { bind } from '../lib-common/binding';
import { StorageException, initSysFolders, sysFolders, FactoryOfAppFSs,
	PerWinStorage, sysFilesOnDevice, userFilesOnDevice }
	from '../main/storage/index';
import { StoragePolicy } from '../ui/app-settings';
import { defer } from '../lib-common/processes';
import { makeFSCollection } from '../lib-client/fs-collection';
import { DeviceFS } from '../lib-client/local-files/device-fs';

type FSType = web3n.files.FSType;
type WritableFS = web3n.files.WritableFS;
type FS = web3n.files.FS;
type StorageService = web3n.storage.Service;
type StorageType = web3n.storage.StorageType;
type FSCollection = web3n.files.FSCollection;
type FSItem = web3n.files.FSItem;

function makeBadAppNameExc(appName: string): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'app',
		badAppName: true,
		appName
	};
}

function makeNotAllowedToOpenAppFSExc(appName: string): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'app',
		notAllowedToOpenFS: true,
		appName
	};
}

function makeNotAllowedToOpenUserFSExc(storageType: StorageType):
		StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'user',
		notAllowedToOpenFS: true,
		storageType
	};
}

function makeNotAllowedToOpenSysFSExc(storageType: StorageType):
		StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		storageSegment: 'system',
		notAllowedToOpenFS: true,
		storageType
	};
}

export class Storages implements FactoryOfAppFSs {
	
	/**
	 * This folder is for a mock of a synced storage.
	 */
	private syncedFS: WritableFS = (undefined as any);

	/**
	 * This folder is for a mock of a local storage.
	 */
	private localFS: WritableFS = (undefined as any);

	private initializing = defer<void>();
	
	constructor() {
		Object.seal(this);
	}
	
	async initFor(userId: string): Promise<void> {
		if (!this.initializing) { throw new Error(
			'Initialization has already been done.'); }
		try {
			this.syncedFS = await makeStorageFS(userId, 'synced');
			this.localFS = await makeStorageFS(userId, 'local');
			await initSysFolders(this.syncedFS);
			await initSysFolders(this.localFS);
			this.initializing.resolve();
			this.initializing = (undefined as any);
		} catch (err) {
			this.initializing.reject(err);
			throw err;
		}
	}


	makeStorageCAP = (policy: StoragePolicy):
			{ remoteCAP: StorageService; close: () => void; } => {
		return (new PerWinStorage(this, policy)).wrap();
	}
	
	async makeSyncedFSForApp(appFolder: string): Promise<WritableFS> {
		if (this.initializing) { await this.initializing.promise; }
		return this.getAppFSIn(this.syncedFS, appFolder);
	}

	async makeLocalFSForApp(appFolder: string): Promise<WritableFS> {
		if (this.initializing) { await this.initializing.promise; }
		return this.getAppFSIn(this.localFS, appFolder);
	}

	private async getAppFSIn(mockFS: WritableFS, appDomain: string):
			Promise<WritableFS> {
		return await mockFS.writableSubRoot(`${sysFolders.appData}/${appDomain}`);
	}

	async getUserFS(type: StorageType): Promise<FSItem> {
		if (this.initializing) { await this.initializing.promise; }
		let fs: WritableFS;
		if (type === 'synced') {
			fs = await this.getUserFSIn(this.syncedFS);
		} else if (type === 'local') {
			fs = await this.getUserFSIn(this.localFS);
		} else if (type === 'device') {
			fs = await userFilesOnDevice();
		} else {
			throw new Error(`Unknown storage type ${type}`);
		}
		return {
			isFolder: true,
			item: fs
		};
	}

	private async getUserFSIn(mockFS: WritableFS): Promise<WritableFS> {
		return await mockFS.writableSubRoot(sysFolders.userFiles);
	}

	async getSysFSs(type: StorageType): Promise<FSItem> {
		if (this.initializing) { await this.initializing.promise; }
		if (type === 'synced') {
			return {
				isCollection: true,
				item: await this.sysFSsIn(this.syncedFS)
			};
		} else if (type === 'local') {
			return {
				isCollection: true,
				item: await this.sysFSsIn(this.localFS)
			};
		} else if (type === 'device') {
			return sysFilesOnDevice();
		} else {
			throw new Error(`Unknown storage type ${type}`);
		}
	}

	private async sysFSsIn(mockFS: WritableFS): Promise<FSCollection> {
		const c = makeFSCollection();
		for (let fsName of [ sysFolders.appData,
				sysFolders.apps, sysFolders.sharedLibs ]) {
			await c.set!(fsName, {
				isFolder: true,
				item: await mockFS.writableSubRoot(fsName)
			});
		}
		return c;
	}

	addPreCloseWait(wait: Promise<void>): void {}

	/**
	 * This method mounts given file on device fs, returning respective device
	 * path. If file is on device fs, this method finds respective path.
	 * @param file 
	 */
	async mountOnDeviceFS(fs: FS, path: string): Promise<string> {
		let devPath = DeviceFS.getPath(path, fs);
		if (typeof devPath === 'string') { return devPath; }

		// XXX implement wrap and mount

		throw new Error('Mounting of storage items is not implemented, yet.');
	}

}

Object.freeze(exports);