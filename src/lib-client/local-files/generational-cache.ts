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

import { WritableFS, ListingEntry } from './device-fs';
import { ByteSource } from '../../lib-common/byte-streaming/common';
import { ObjSource } from '../../lib-common/obj-streaming/common';
import { NamedProcs } from '../../lib-common/processes';
import { FileException } from '../../lib-common/exceptions/file';
import { logWarning } from '../logging/log-to-file';

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
	const now = nowInHours();
	return {
		yesterday: now,
		week: now,
		month: now,
		older: now
	};
}


export interface Exception extends web3n.RuntimeException {
	type: 'cache';
	name: string;
	notFound?: true;
	alreadyExist?: true;
	concurrentTransaction?: true;
}

export function makeNotFoundExc(name: string): Exception {
	return {
		runtimeException: true,
		type: 'cache',
		name: name,
		notFound: true
	};
}

export function makeConcurrentTransExc(name: string): Exception {
	return {
		runtimeException: true,
		type: 'cache',
		name: name,
		concurrentTransaction: true
	};
}

export function makeAlreadyExistExc(name: string): Exception {
	return {
		runtimeException: true,
		type: 'cache',
		name: name,
		alreadyExist: true
	};
}

export function makeObjSourceFromByteSources(
		headGetter: () => Promise<Uint8Array>,
		segSource: ByteSource, version: number): ObjSource {
	let headerSize: number|undefined = undefined;
	return {
		
		version,

		readHeader: async (): Promise<Uint8Array> => {
			const header = await headGetter();
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
			private fs: WritableFS,
			private canMove?: (folderLst: ListingEntry[]) => boolean) {
		Object.freeze(this);
	}
	
	async init(rotationHours: number): Promise<void> {
		await this.fs.makeFolder(TODAY_DIR);
		try {
			await this.fs.readJSONFile(CACHE_ROTATIONS_FILE_NAME);
		} catch (err) {
			await this.fs.writeJSONFile(
				CACHE_ROTATIONS_FILE_NAME, makeNewInfo());
		}
		// set scheduled rotations
		this.setNextCacheRotation(rotationHours);
		// do rotation now, on a startup
		this.rotate();
	}
	
	private setNextCacheRotation(hours: number): void {
		setTimeout(async () => {
			await this.rotate();
			this.setNextCacheRotation(hours);
		}, hours*60*60*1000).unref();
	}
	
	private async moveBacketContent(src: string, dst: string,
			canMove?: (folderLst: ListingEntry[]) => boolean):
			Promise<void> {
		try {
			const thingsToMove = await this.fs.listFolder(src);
			for (const entry of thingsToMove) {
				if (this.folderProcs.getP(entry.name)) { return; }
				await this.folderProcs.start(entry.name, async () => {
					const entryPath = `${src}/${entry.name}`;
					if (canMove) {
						const folderLst = await this.fs.listFolder(
							`${src}/${entry.name}`);
						if (!canMove(folderLst)) { return; }
					}
					if (entry.isFolder) {
						await this.fs.move(entryPath, `${dst}/${entry.name}`);
					} else if (entry.isFile) {
						logWarning(`Removing an unexpected file in cache of folders: ${entryPath}`);
						await this.fs.deleteFile(entryPath);
					} else {
						logWarning(`Unexpected entry in cache of folders: ${entryPath}`);
					}
				}).catch(() => {});
			}
		} catch (exc) {
			notFoundOrReThrow(exc);
		}
	}
	
	private async rotate(): Promise<void> {
		const now = nowInHours();
		const info = await this.fs.readJSONFile<RotationsInfo>(
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
		const backets: string[][] = [];
		for (const bName of ALL_BACKETS) {
			try {
				const lst = await this.fs.listFolder(bName);
				const paths = new Array<string>(lst.length);
				for (let i=0; i<lst.length; i+=1) {
					paths[i] = `${bName}/${lst[i].name}`;
				}
				backets.push(paths);
			} catch (exc) {
				notFoundOrReThrow(exc);
			}
		}
		return backets;
	}

	/**
	 * This method promises to return paths of all recent folders.
	 */
	async listRecent(): Promise<string[]> {
		const lst = await this.fs.listFolder(TODAY_DIR);
		const folderPaths: string[] = [];
		for (const entry of lst) {
			folderPaths.push(`${TODAY_DIR}/${entry.name}`);
		}
		return folderPaths;
	}

	private async findFolder(fName: string):
			Promise<{ path: string; isRecent: boolean; } | undefined> {
		let isRecent = true;
		for (const backet of ALL_BACKETS) {
			const path = backet+'/'+fName;
			const found = await this.fs.checkFolderPresence(path);
			if (found) { return { path, isRecent }; }
			isRecent = false;
		}
	}
	
	async getOrMakeFolder(fName: string): Promise<string> {
		const folder = await this.findFolder(fName);
		if (folder) {
			if (folder.isRecent) {
				return folder.path;
			} else {
				const pathInRecent = `${TODAY_DIR}/${fName}`;
				await this.fs.move(folder.path, pathInRecent);
				return pathInRecent;
			}
		} else {
			const pathInRecent = `${TODAY_DIR}/${fName}`;
			await this.fs.makeFolder(pathInRecent);
			return pathInRecent;
		}
	}
	
	async getFolder(fName: string): Promise<string> {
		const folder = await this.findFolder(fName);
		if (!folder) { throw makeNotFoundExc(fName); }
		if (folder.isRecent) {
			return folder.path;
		} else {
			const pathInRecent = `${TODAY_DIR}/${fName}`;
			await this.fs.move(folder.path, pathInRecent);
			return pathInRecent;
		}
	}
	
	async makeNewFolder(fName: string): Promise<string> {
		if (await this.findFolder(fName)) {
			throw makeAlreadyExistExc(fName);
		}
		const pathInRecent = `${TODAY_DIR}/${fName}`;
		await this.fs.makeFolder(pathInRecent);
		return pathInRecent;
	}
	
	async removeFolder(fName: string): Promise<void> {
		const folder = await this.findFolder(fName);
		if (folder) {
			await this.fs.deleteFolder(folder.path, true);
		}
	}
	
}
Object.freeze(CacheOfFolders.prototype);
Object.freeze(CacheOfFolders);

Object.freeze(exports);