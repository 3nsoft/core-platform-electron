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

import { makeStorageFS } from './mock-files';
import { FS } from '../../lib-client/local-files/device-fs';
import { bind } from '../../lib-common/binding';
import { sysFolders } from '../../lib-client/3nstorage/xsp-fs/common';
import { StorageException as BaseExc, StorageExceptionType }
	from '../../lib-client/3nstorage/exceptions';
import { makeRuntimeException } from '../../lib-common/exceptions/runtime';
import { defer } from '../../lib-common/processes';

export interface StorageException extends BaseExc {
	appName?: string;
	badAppName?: boolean;
	notAllowedToOpenFS?: boolean;
}

function makeBadAppNameExc(appName: string): StorageException {
	let exc = <StorageException> makeRuntimeException(
		'badAppName', StorageExceptionType);
	exc.appName = appName;
	return exc;
}

function makeNotAllowedToOpenFSExc(appName: string): StorageException {
	let exc = <StorageException> makeRuntimeException(
		'notAllowedToOpenFS', StorageExceptionType);
	exc.appName = appName;
	return exc;
}

export interface StorageMockConfig {
	apps: string[];
}

const LOCAL_STORAGE_DIR = 'local';
const SYNCED_STORAGE_DIR = 'synced';

export class StorageMock implements web3n.storage.Service {
	
	private userId: string = (undefined as any);

	/**
	 * This folder is for a mock of a synced storage.
	 */
	private syncedFS: FS = (undefined as any);

	/**
	 * This folder is for a mock of a local storage.
	 */
	private localFS: FS = (undefined as any);

	private apps = new Set<string>();
	private initializing = defer<void>();
	
	constructor() {
		Object.seal(this);
	}
	
	async initFor(userId: string, config: StorageMockConfig): Promise<void> {
		if (!this.initializing) { throw new Error(
			'Initialization has already been done.'); }
		try {
			this.userId = userId;
			if (Array.isArray(config.apps) && (config.apps.length > 0)) {
				for (let app of config.apps) {
					this.apps.add(app);
				}
			} else {
				throw new Error('No app names given in a config for mock storage.');
			}
			let storageFS = await makeStorageFS(this.userId);
			this.syncedFS = await storageFS.writableSubRoot(SYNCED_STORAGE_DIR);
			this.localFS = await storageFS.writableSubRoot(LOCAL_STORAGE_DIR);
			for (let sysFolderField of Object.keys(sysFolders)) {
				await this.syncedFS.makeFolder(sysFolders[sysFolderField]);
				await this.localFS.makeFolder(sysFolders[sysFolderField]);
			}
			this.initializing.resolve();
			this.initializing = (undefined as any);
		} catch (err) {
			this.initializing.reject(err);
			throw err;
		}
	}
	
	private async getAppFSIn(mockFS: FS, appDomain: string):
			Promise<web3n.storage.FS> {
		if (this.initializing) { await this.initializing.promise; }
		if (this.apps.has(appDomain)) {
			let appFS = await mockFS.writableSubRoot(
				sysFolders.appData+'/'+appDomain);
			return toStorageFS(appFS);
		} else {
			if ((typeof appDomain !== 'string') ||
					(appDomain.length === 0) ||
					(appDomain.indexOf('/') >= 0)) {
				throw makeBadAppNameExc(appDomain);
			}
			throw makeNotAllowedToOpenFSExc(appDomain);
		}
	}

	getAppSyncedFS(appDomain: string): Promise<web3n.storage.FS> {
		return this.getAppFSIn(this.syncedFS, appDomain);
	}

	getAppLocalFS(appDomain: string): Promise<web3n.storage.FS> {
		return this.getAppFSIn(this.localFS, appDomain);
	}
	
	wrap(): web3n.storage.Service {
		let w: web3n.storage.Service = {
			getAppSyncedFS: bind(this, this.getAppSyncedFS),
			getAppLocalFS: bind(this, this.getAppLocalFS)
		};
		Object.freeze(w);
		return w;
	}

}

function notImplementedExc(method: string): () => never {
	return () => {
		throw new Error(`FS.${method} method is not implemented in mock.`)
	};
}

export function toStorageFS(deviceFS: web3n.files.FS): web3n.storage.FS {
	let fs: web3n.storage.FS = {
		versioned: deviceFS.versioned,
		writable: deviceFS.writable,
		name: deviceFS.name,
		async close() {},
		deleteFile: deviceFS.deleteFile,
		deleteFolder: deviceFS.deleteFolder,
		listFolder: deviceFS.listFolder,
		makeFolder: deviceFS.makeFolder,
		async readonlySubRoot(folder: string, folderName?: string) {
			let subRoot = await deviceFS.readonlySubRoot(folder, folderName);
			return toStorageFS(subRoot);
		},
		async writableSubRoot(folder: string, folderName?: string) {
			let subRoot = await deviceFS.writableSubRoot(folder, folderName);
			return toStorageFS(subRoot);
		},
		move: deviceFS.move,
		readJSONFile: deviceFS.readJSONFile,
		readTxtFile: deviceFS.readTxtFile,
		writeJSONFile: deviceFS.writeJSONFile,
		writeTxtFile: deviceFS.writeTxtFile,
		checkFilePresence: deviceFS.checkFilePresence,
		checkFolderPresence: deviceFS.checkFolderPresence,
		getByteSink: deviceFS.getByteSink,
		getByteSource: deviceFS.getByteSource,
		readBytes: deviceFS.readBytes,
		writeBytes: deviceFS.writeBytes,
		statFile: deviceFS.statFile,
		readonlyFile: deviceFS.readonlyFile,
		writableFile: deviceFS.writableFile,
		copyFile: deviceFS.copyFile,
		copyFolder: deviceFS.copyFolder,
		saveFile: deviceFS.saveFile,
		saveFolder: deviceFS.saveFolder,
		link: notImplementedExc('link'),
		readLink: notImplementedExc('readLink'),
		deleteLink: notImplementedExc('deleteLink'),
		versionedGetByteSink: notImplementedExc('versionedGetByteSink'),
		versionedGetByteSource: notImplementedExc('versionedGetByteSource'),
		versionedListFolder: notImplementedExc('versionedListFolder'),
		versionedReadBytes: notImplementedExc('versionedReadBytes'),
		versionedReadJSONFile: notImplementedExc('versionedReadJSONFile'),
		versionedReadTxtFile: notImplementedExc('versionedReadTxtFile'),
		versionedWriteBytes: notImplementedExc('versionedWriteBytes'),
		versionedWriteJSONFile: notImplementedExc('versionedWriteJSONFile'),
		versionedWriteTxtFile: notImplementedExc('versionedWriteTxtFile'),
	};
	Object.freeze(fs);
	return fs;
}

Object.freeze(exports);