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

export class StorageMock implements Web3N.Storage.Service {
	
	private userId: string = null;
	private fs: FS = null;
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
			this.fs = await makeStorageFS(this.userId);
			for (let sysFolderField of Object.keys(sysFolders)) {
				await this.fs.makeFolder(sysFolders[sysFolderField]);
			}
			this.initializing.resolve();
			this.initializing = null;
		} catch (err) {
			this.initializing.reject(err);
			throw err;
		}
	}
	
	async getAppFS(appDomain: string): Promise<Web3N.Storage.FS> {
		if (this.initializing) { await this.initializing.promise; }
		if (this.apps.has(appDomain)) {
			let appFS = await this.fs.makeSubRoot(
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
	
	wrap(): Web3N.Storage.Service {
		let w: Web3N.Storage.Service = {
			getAppFS: bind(this, this.getAppFS)
		};
		Object.freeze(w);
		return w;
	}

}

export function toStorageFS(deviceFS: Web3N.Files.FS): Web3N.Storage.FS {
	let fs: Web3N.Storage.FS = {
		async close() {},
		deleteFile: deviceFS.deleteFile,
		deleteFolder: deviceFS.deleteFolder,
		listFolder: deviceFS.listFolder,
		makeFolder: deviceFS.makeFolder,
		async makeSubRoot(folder: string) {
			let subRoot = await deviceFS.makeSubRoot(folder);
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
		writableFile: deviceFS.writableFile
	};
	Object.freeze(fs);
	return fs;
}

Object.freeze(exports);