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

import { FS, ListingEntry } from './device-fs';
import { RuntimeException } from '../../lib-common/exceptions/runtime';
import { ByteSource } from '../../lib-common/byte-streaming/common';
import { ObjSource } from '../../lib-common/obj-streaming/common';
import { NamedProcs } from '../../lib-common/processes';
import { FileException } from '../../lib-common/exceptions/file';

const CACHE_ROTATIONS_FILE_NAME = 'rotations.json';

const TODAY_DIR = 'today';
const YESTERDAY_DIR = 'yesterday';
const WEEK_DIR = 'week';
const MOTNH_DIR = 'month';
const OLDER_DIR = 'older';

const ALL_BACKETS = [ TODAY_DIR, YESTERDAY_DIR, WEEK_DIR,
	MOTNH_DIR, OLDER_DIR ];
Object.freeze(ALL_BACKETS);

interface RotationsInfo {
	yesterday: number;
	week: number;
	month: number;
	older: number;
}

function nowInHours(): number {
	return Math.floor(Date.now() / (60*60*1000));
}

function makeNewInfo(): RotationsInfo {
	let now = nowInHours();
	return {
		yesterday: now,
		week: now,
		month: now,
		older: now
	};
}

export const ExceptionType = 'cache';

export interface Exception extends RuntimeException {
	name: string;
	notFound?: boolean;
	alreadyExist?: boolean;
	concurrentTransaction?: boolean;
}

function makeException(name: string): Exception {
	let exc: Exception = {
		runtimeException: true,
		type: ExceptionType,
		name: name
	};
	return exc;
}

export function makeNotFoundExc(name: string): Exception {
	let exc = makeException(name);
	exc.notFound = true;
	return exc;
}

export function makeConcurrentTransExc(name: string): Exception {
	let exc = makeException(name);
	exc.concurrentTransaction = true;
	return exc;
}

export function makeAlreadyExistExc(name: string): Exception {
	let exc = makeException(name);
	exc.alreadyExist = true;
	return exc;
}

export function makeObjSourceFromByteSources(
		headGetter: () => Promise<Uint8Array>,
		segSource: ByteSource, version: number): ObjSource {
	let headerSize: number|undefined = undefined;
	return {
		
		getObjVersion(): number {
			return version;
		},

		readHeader: async (): Promise<Uint8Array> => {
			let header = await headGetter();
			if (typeof headerSize !== 'number') {
				headerSize = header.length;
			}
			return header;
		},
		
		segSrc: segSource
	}
}

/**
 * This is a catch callback, which returns undefined on file(folder) not found
 * exception, and re-throws all other exceptions/errors.
 */
function notFoundOrReThrow(exc: FileException): void {
	if (!exc.notFound) { throw exc; }
}

export class CacheOfFolders {
	
	/**
	 * This process chaining is used to synchronize access on per-folder basis.
	 */
	folderProcs = new NamedProcs();
	
	constructor(
			private fs: FS,
			private canMove?: (folderLst: ListingEntry[]) => boolean) {
		Object.freeze(this);
	}
	
	async init(rotationHours?: number): Promise<void> {
		await this.fs.makeFolder(TODAY_DIR);
		try {
			await this.fs.readJSONFile(CACHE_ROTATIONS_FILE_NAME);
		} catch (err) {
			await this.fs.writeJSONFile(
				CACHE_ROTATIONS_FILE_NAME, makeNewInfo());
		}
		await this.rotate();
		if (rotationHours !== undefined) {
			this.setNextCacheRotation(rotationHours);
		}
	}
	
	private setNextCacheRotation(hours: number): void {
		setTimeout(async () => {
			await this.rotate();
			this.setNextCacheRotation(hours);
		}, hours*60*60*1000);
	}
	
	private async moveBacketContent(src: string, dst: string,
			canMove?: (folderLst: ListingEntry[]) => boolean):
			Promise<void> {
		try {
			let thingsToMove = await this.fs.listFolder(src);
			for (let entry of thingsToMove) {
				await this.folderProcs.start(entry.name, async () => {
					let entryPath = `${src}/${entry.name}`;
					if (canMove) {
						let folderLst = await this.fs.listFolder(
							`${src}/${entry.name}`);
						if (!canMove(folderLst)) { return; }
					}
					if (entry.isFolder) {
						await this.fs.move(entryPath, `${dst}/${entry.name}`);
					} else if (entry.isFile) {
						console.warn('Removing an unexpected file in cache of folders: '+
							entryPath);
						await this.fs.deleteFile(entryPath);
					} else {
						console.warn('Unexpected entry in cache of folders: '+entryPath);
					}
				}).catch(() => {});
			}
		} catch (exc ) {
			notFoundOrReThrow(exc);
		}
	}
	
	private async rotate(): Promise<void> {
		let now = nowInHours();
		let info = await this.fs.readJSONFile<RotationsInfo>(
			CACHE_ROTATIONS_FILE_NAME);
		if ((now - info.older) >= 30*24) {
			await this.moveBacketContent(MOTNH_DIR, OLDER_DIR);
			info.older = now;
		}
		if ((now - info.month) >= 7*24) {
			await this.moveBacketContent(WEEK_DIR, MOTNH_DIR);
			info.month = now;
		}
		if ((now - info.week) >= 24) {
			await this.moveBacketContent(YESTERDAY_DIR, WEEK_DIR);
			info.week = now;
		}
		if ((now - info.yesterday) >= 24) {
			await this.moveBacketContent(TODAY_DIR, YESTERDAY_DIR, this.canMove);
			info.yesterday = now;
		}
		this.fs.writeJSONFile(CACHE_ROTATIONS_FILE_NAME, info);
	}

	async listFolders(): Promise<string[][]> {
		let backets: string[][] = [];
		for (let bName of ALL_BACKETS) {
			try {
				let lst = await this.fs.listFolder(bName);
				let paths = new Array<string>(lst.length);
				for (let i=0; i < lst.length; i+=1) {
					paths[i] = `${bName}/${lst[i].name}`;
				}
				backets.push(paths);
			} catch (exc) {
				notFoundOrReThrow(exc);
			}
		}
		return backets;
	}

	private async findFolder(fName: string):
			Promise<{ path: string; isRecent: boolean; } | undefined> {
		let isRecent = true;
		for (let backet of ALL_BACKETS) {
			let path = backet+'/'+fName;
			let found = await this.fs.checkFolderPresence(path);
			if (found) { return { path, isRecent }; }
			isRecent = false;
		}
	}
	
	async getOrMakeFolder(fName: string): Promise<string> {
		let folder = await this.findFolder(fName);
		if (folder) {
			if (folder.isRecent) {
				return folder.path;
			} else {
				let pathInRecent = `${TODAY_DIR}/${fName}`;
				await this.fs.move(folder.path, pathInRecent);
				return pathInRecent;
			}
		} else {
			let pathInRecent = `${TODAY_DIR}/${fName}`;
			await this.fs.makeFolder(pathInRecent);
			return pathInRecent;
		}
	}
	
	async getFolder(fName: string): Promise<string> {
		let folder = await this.findFolder(fName);
		if (!folder) { throw makeNotFoundExc(fName); }
		if (folder.isRecent) {
			return folder.path;
		} else {
			let pathInRecent = `${TODAY_DIR}/${fName}`;
			await this.fs.move(folder.path, pathInRecent);
			return pathInRecent;
		}
	}
	
	async makeNewFolder(fName: string): Promise<string> {
		if (await this.findFolder(fName)) {
			throw makeAlreadyExistExc(fName);
		}
		let pathInRecent = `${TODAY_DIR}/${fName}`;
		await this.fs.makeFolder(pathInRecent);
		return pathInRecent;
	}
	
	async removeFolder(fName: string): Promise<void> {
		let folder = await this.findFolder(fName);
		if (folder) {
			await this.fs.deleteFolder(folder.path, true);
		}
	}
	
}
Object.freeze(CacheOfFolders.prototype);
Object.freeze(CacheOfFolders);

Object.freeze(exports);