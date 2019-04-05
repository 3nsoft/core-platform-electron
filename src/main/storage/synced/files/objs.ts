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

import { CacheOfFolders, Exception as CacheExc, makeNotFoundExc }
	from '../../../../lib-client/local-files/generational-cache';
import { FileException } from '../../../../lib-common/exceptions/file';
import { TimeWindowCache } from '../../../../lib-common/time-window-cache';
import { parseDiffAndOffsets } from '../../../../lib-client/obj-file-on-dev-fs';
import { bind } from '../../../../lib-common/binding';
import { GC, makeGC } from './gc';
import { SyncedObjVersions, SyncedVersions } from './synced-versions';
import { LocalObjVersions, LocalVersions, LOCAL_FILE_NAME_EXT,
	UPLOAD_INFO_FILE_EXT, UNSYNCED_REMOVAL }
	from './local-versions';
import { Observable } from 'rxjs';
import { sleep } from '../../../../lib-common/processes';

export { SyncedObjVersions } from './synced-versions';
export { LocalObjVersions } from './local-versions';
export { ObjReader } from './obj-reader';
export { DiffInfo, addDiffSectionTo }
	from '../../../../lib-common/service-api/3nstorage/owner';

/**
 * This is a directory name for root, cause root's id is null.
 */
const ROOT_OBJ_DIR = '=root=';

/**
 * This file contains status information about object. This file must always
 * be present in object's folder.
 */
const STATUS_INFO_FILE_NAME = 'status';

export type ObjId = string|null;

/**
 * Storage object can be in following states:
 * 
 * 1) Unsynced state, is when current obj's version is local, and hasn't been
 *    synced, yet.
 * 
 * 2) Unsynced conflicting state, is when current local version is same, or is
 *    already smaller than current version on a server.
 * 
 * 3) Synced state, is when there is no new local version that needs syncing.
 */
export type SyncState = 'synced' | 'unsynced' | 'conflicting';

export interface ObjStatusInfo {
	objId: ObjId;
	isArchived?: boolean;
	syncState: SyncState;
	latestSynced?: number;
	conflictingRemVer?: number;
	current?: {
		version: number;
		isLocal: boolean;
	};
	archivedVersions?: number[];
	gcWorkInfo?: object;
}

/**
 * Disk cache is not talking over the network, and provides read/write access
 * method to cache files.
 */
export interface ObjFiles {

	/**
	 * This function promises to return either object's status info, when an
	 * object is found for a given id, or an undefined, when object is not
	 * present in cache.
	 * Note that it is possible to get status info without current version set,
	 * yet, object is not marked as archived. This can happens when object
	 * starts in cache as a download of an already archived version.
	 * @param objId
	 */
	findObj(objId: ObjId): Promise<ObjStatusInfo|undefined>;
	
	/**
	 * This function promises to return a segments length of given object
	 * version in cache.
	 * @param objId
	 * @param version
	 * @param countBase if version is recorded as a diff, this flag's true
	 * (default) value, ensures that relevant base bytes are accounted for.
	 * Otherwise, false value, ensures that only new to this version bytes
	 * are accounted for.  
	 */
	getSegsSize(objId: ObjId, version: number, countBase?: boolean):
		Promise<number>;
	
	/**
	 * This function removes a particular archived version of an object.
	 * Note that non-archived versions are not visible from status file, and are
	 * garbage collected. Thus, one should not worry about passed non-archived
	 * versions in cache.
	 * @param objId
	 * @param version
	 */
	removeArchivedObjVersion(objId: ObjId, version: number): Promise<void>;

	synced: SyncedObjVersions;
	local: LocalObjVersions;

	/**
	 * This method should be used on system startup.
	 * This methos returns an observable, encapsulating a process, which, when
	 * subscribed, starts to give objects that need to be synced. Objects are
	 * trickled one-by-one, spaced in time so as not to consume all resources.
	 */
	collectUnsyncedObjs(): Observable<ObjId>;

}

type WritableFS = web3n.files.WritableFS;
type ListingEntry = web3n.files.ListingEntry;

const CACHE_ROTATION_HOURS = 12;

export function objIdToFolderName(objId: ObjId): string {
	return ((objId === null) ? ROOT_OBJ_DIR : objId.toLowerCase());
}

export class Objs implements ObjFiles {
	
	private cache: CacheOfFolders = (undefined as any);
	
	gc: GC;

	synced: SyncedVersions;
	local: LocalVersions;
	
	/**
	 * This is a cache for object status with object ids used as keys.
	 */
	private objStatus = new TimeWindowCache<ObjId, ObjStatusInfo>(60*1000);
	
	constructor(
			public fs: WritableFS) {
		this.cache = new CacheOfFolders(this.fs, checkToOkCacheMove);
		this.gc = makeGC(this.cache.folderProcs, this);
		this.synced = new SyncedVersions(this);
		this.local = new LocalVersions(this);
		Object.freeze(this);
	}
	
	async init(): Promise<void> {
		await this.cache.init(CACHE_ROTATION_HOURS);
	}

	collectUnsyncedObjs(): Observable<ObjId> {
		return (Observable.from([undefined])
		// listing recent folders, exactly once
		.flatMap(() => this.cache.listRecent())
		// flatten array and space it in time, to process folders one by one
		.flatMap(objFolders => objFolders)
		.flatMap(async objFolder => {
			await sleep(20);
			return objFolder;
		}, 1)
		// check, emiting objId, if unsynced, and undefined, if synced
		.flatMap(objFolder => this.cache.folderProcs.startOrChain(objFolder, async () => {
			const statusFile = `${objFolder}/${STATUS_INFO_FILE_NAME}`;
			const status = await this.fs.readJSONFile<ObjStatusInfo>(statusFile)
			.catch(notFoundOrReThrow);
			if (!status || (status.syncState === 'synced')) { return; }
			// cache status, cause it will be used soon, and we save trip to disk
			if (!this.objStatus.has(status.objId)) {
				this.objStatus.set(status.objId, status);
			}
			return status.objId;
		}))
		.filter(objId => (objId !== undefined)) as Observable<ObjId>);
	}

	/**
	 * @param objId
	 * @param throwIfMissing is a flag, which true value forces throwing cache
	 * exception when object is not found. Default value is true.
	 * @return a promise, resolvable to object's folder path, when object is
	 * found in cache, and to undefined, when it is not found.
	 */
	getObjFolder(objId: ObjId, throwIfMissing = true):
			Promise<string|undefined> {
		objId = objIdToFolderName(objId);
		return this.cache.getFolder(objId).catch((exc: CacheExc) => {
			if (!exc.notFound || throwIfMissing) { throw exc; }
			return undefined;
		});
	}

	/**
	 * This removes object folder, if it was found.
	 * Use this instead of direct removal via fs, cause it may be removing parent
	 * folder(s) as well, according to cache's needs.
	 * @param objId 
	 */
	removeObjFolder(objId: ObjId): Promise<void> {
		if (objId === null) { throw new Error(`Cannot remove root object`); }
		objId = objIdToFolderName(objId);
		return this.cache.removeFolder(objId).catch((exc: CacheExc) => {
			if (!exc.notFound) { throw exc; }
		});
	}
	
	/**
	 * This returns a promise, resolvable to object's folder path, when object is
	 * either found or created in cache.
	 * @param objId
	 */
	getOrMakeObjFolder(objId: ObjId): Promise<string> {
		objId = objIdToFolderName(objId);
		return this.cache.getOrMakeFolder(objId);
	}

	/**
	 * This method returns a bound wrap of a given method synced per storage
	 * object, on which method operates. Synchronization is done via chaining
	 * every execution under given object id.
	 * @param thisArg is "this" to bind with a given method.
	 * @param method is a method, which first parameter must be object's id.
	 */
	syncAndBind<T extends Function>(thisArg: any, method: T): T {
		return <T> <any> ((...args: any[]) => {
			const fName = objIdToFolderName(args[0]);
			return this.cache.folderProcs.startOrChain<any>(fName, () => {
				return method.apply(thisArg, args);
			});
		});
	}

	/**
	 * This returns object status info, checking, first, memory cache and,
	 * second, a disk.
	 * @param objId
	 * @param objFolder should be given in those contexts where objects folder
	 * path is already known, so as to not do computation second time.
	 */
	async getObjStatus(objId: ObjId, objFolder?: string):
			Promise<ObjStatusInfo> {
		let status = this.objStatus.get(objId);
		if (status) { return status; }
		if (!objFolder) {
			objFolder = await this.getObjFolder(objId);
		}
		status = await this.fs.readJSONFile<ObjStatusInfo>(
			`${objFolder}/${STATUS_INFO_FILE_NAME}`);
		this.objStatus.set(objId, status);
		return status;
	}

	/**
	 * This sets object status info in both memory cache and on a disk.
	 * @param status
	 * @param objFolder should be given in those contexts where objects folder
	 * path is already known, so as to not do computation second time.
	 */
	async setObjStatus(status: ObjStatusInfo,
			objFolder?: string): Promise<void> {
		this.objStatus.set(status.objId, status);
		if (!objFolder) {
			objFolder = await this.getObjFolder(status.objId);
		}
		await this.fs.writeJSONFile(`${objFolder}/${STATUS_INFO_FILE_NAME}`, status);
	}

	findObj(objId: ObjId): Promise<ObjStatusInfo|undefined> {
		return this.getObjStatus(objId).catch(notFoundOrReThrow);
	}

	async setArchivedVersion(objId: ObjId, version: number,
			createInfoIfMissing = false): Promise<void> {
		const objFolder = await this.getObjFolder(objId, false);
		if (!objFolder) { return; }

		// XXX use createInfoIfMissing
		
		const status = await this.getObjStatus(objId, objFolder);
		if (status.current) {
			if (status.current.isLocal) {
				if (status.conflictingRemVer
					&& (status.conflictingRemVer >= version)) { return; }
				status.conflictingRemVer = version;
				status.syncState = 'conflicting';
			} else {
				if (status.current.version >= version) { return; }
				status.current.version = version;
			}
		} else {
			status.current = { version, isLocal: false };
			// XXX is it fine to unconditionally set synced?
			status.syncState = 'synced';
		}
		await this.setObjStatus(status, objFolder);
	}

	async setCurrentLocalVersion(objFolder: string, objId: ObjId,
			version: number): Promise<void> {
		if (version > 1) {
			// at this point we assume that status file is present on the disk
			const status = await this.getObjStatus(objId, objFolder);
			if (status.syncState === 'synced') {
				status.syncState = 'unsynced';
			}
			status.current = { version, isLocal: true };
			await this.setObjStatus(status, objFolder);
		} else {
			const status: ObjStatusInfo = {
				objId,
				syncState: 'unsynced',
				current: { version, isLocal: true },
			};
			await this.setObjStatus(status, objFolder);
		}
	}
	
	async getSegsSize(objId: ObjId, version: number, countBase = true):
			Promise<number> {
		const objFolder = await this.getObjFolder(objId);
		// It is not known whether version file is local or synced. Hence,
		// we try local first, and then synced, adjusting path variable.
		// This solution is a little ugly (two times changing path), but it works.
		let path = `${objFolder}/${version}.${LOCAL_FILE_NAME_EXT}`;
		const { segsOffset, diff } = await parseDiffAndOffsets(this.fs, path)
		.catch((exc: FileException) => {
			if (!exc.notFound) { throw exc; }
			path = `${objFolder}/${version}.`;
			return parseDiffAndOffsets(this.fs, path);
		});
		if (countBase && diff) {
			return diff.segsSize;
		} else {
			const stats = await this.fs.stat(path)
			.catch((exc: FileException) => {
				if (!exc.notFound) { throw exc; }
				path = `${objFolder}/${version}.`;
				return this.fs.stat(path)
			});
			if (typeof stats.size !== 'number') { throw new Error(
				`Stat of file on disk didn't return a numeric size.`); }
			return stats.size - segsOffset;
		}
	}

	async removeArchivedObjVersion(objId: ObjId, version: number):
			Promise<void> {
		const status = await this.getObjStatus(objId);
		if (status.archivedVersions) {
			const arch = status.archivedVersions;
			const vInd = arch.indexOf(version);
			if (vInd >= 0) {
				arch.splice(vInd, 1);
				await this.setObjStatus(status);
			}
		}
		this.gc.scheduleCollection(objId);
	}
	
	async removeCurrentObjVersion(objId: ObjId, synced: boolean): Promise<void> {
		const status = await this.getObjStatus(objId);
		if (status.isArchived) { throw makeNotFoundExc(
			`${objId}; version: current`); }
		status.isArchived = true;
		delete status.current;
		status.syncState = (synced ? 'synced' : 'unsynced');
		await this.setObjStatus(status);
		this.gc.scheduleCollection(objId);
	}

	wrap(): ObjFiles {
		const w: ObjFiles = {
			findObj: this.syncAndBind(this, this.findObj),
			getSegsSize: this.syncAndBind(this, this.getSegsSize),
			removeArchivedObjVersion: this.syncAndBind(this,
				this.removeArchivedObjVersion),
			synced: this.synced.wrap(),
			local: this.local.wrap(),
			collectUnsyncedObjs: bind(this, this.collectUnsyncedObjs)
		};
		Object.freeze(w);
		return w;
	}

}
Object.freeze(Objs.prototype);
Object.freeze(Objs);

/**
 * This is a catch callback, which returns undefined on file(folder) not found
 * exception, and re-throws all other exceptions/errors.
 */
export function notFoundOrReThrow(exc: FileException): undefined {
	if (!exc.notFound) { throw exc; }
	return;
}

function checkToOkCacheMove(objFolderList: ListingEntry[]): boolean {
	for (const entity of objFolderList) {
		if (entity.name.endsWith(LOCAL_FILE_NAME_EXT)
		|| entity.name.endsWith(UPLOAD_INFO_FILE_EXT)
		|| (entity.name === UNSYNCED_REMOVAL)) { return false; }
	}
	return true;
}

export async function makeObjs(fs: WritableFS): Promise<ObjFiles> {
	const objFiles = new Objs(fs);
	await objFiles.init();
	return objFiles.wrap();
}

Object.freeze(exports);