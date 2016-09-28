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

import { FS, ListingEntry } from '../../lib-client/local-files/device-fs';
import { NamedProcs } from '../../lib-common/processes';
import { CacheOfFolders, Exception as CacheExc }
	from '../../lib-client/local-files/generational-cache';
import { ScryptGenParams } from '../../lib-client/key-derivation';
import { ByteSource } from '../../lib-common/byte-streaming/common';
import { ObjSource } from '../../lib-common/obj-streaming/common';
import { FileException } from '../../lib-common/exceptions/file';
import { bind } from '../../lib-common/binding';
import { mergeRegions } from '../../lib-client/local-files/regions';
import { pipe } from '../../lib-common/byte-streaming/pipe';
import { makeObjExistsExc } from '../../lib-client/3nstorage/exceptions';
import { makeNotFoundExc }
	from '../../lib-client/local-files/generational-cache';
import { TimeWindowCache } from '../../lib-common/time-window-cache';
import { StorageOwner as RemoteStorageOwner }
	from '../../lib-client/3nstorage/service';
import { Uploader } from './uploader';
import { Downloader } from './downloader';
import { DiffInfo } from '../../lib-common/service-api/3nstorage/owner';
import { toBuffer } from '../../lib-common/buffer-utils';
import { errWithCause } from '../../lib-common/exceptions/error';

export { DiffInfo, addDiffSectionTo }
	from '../../lib-common/service-api/3nstorage/owner';

const CACHE_ROTATION_HOURS = 12;

const ROOT_OBJ_DIR = '=root=';
const CACHE_PROGRESS_FILE_EXT = 'progress';
const STATUS_FILE_NAME = 'status';
const SYNC_UPLOAD_FILE_NAME = 'sync-upload';

/**
 * This byte sequence starts file with the following layout:
 * 1) 3 bytes with this sequence;
 * 2) 5 bytes with offset, at which segments start;
 * 3) header bytes up to start of segments;
 * 4) segments bytes up to file end.
 */
const ALL_BYTES_FILE_START: Uint8Array = new Buffer('all', 'utf8');
/**
 * This byte sequence starts file with the following layout:
 * 1) 3 bytes with this sequence;
 * 2) 5 bytes with offset, at which header starts;
 * 3) 5 bytes with offset, at which segments start;
 * 4) header bytes up to start of segments;
 * 5) segments bytes up to file end.
 */
const DIFF_BYTES_FILE_START: Uint8Array = new Buffer('dif', 'utf8');

export interface SyncAction {
	version: number;
	completeUpload?: boolean;
	deleteObj?: boolean;
	deleteArchivedVersion?: boolean;
	intentionNum?: number;
}

export interface SyncLog {
	objId: string;
	progress?: any;
	currentAction?: SyncAction;
	counter: number;
	backlog: SyncAction[];
}

export interface CachingProgress {
	segsSize: number;
	segs: { start: number; end: number; }[];
	isDone?: boolean;
}

export interface ObjStatusInfo {
	objId: string;
	isArchived?: boolean;
	
	/**
	 * This field indicates current object version in cache.
	 */
	currentVersion?: number;

	/**
	 * This is a list of archived versions in the cache.
	 */
	archivedVersions?: number[];

	/**
	 * This is a map from base version to diff-ed version(s), that use(s) base.
	 */
	baseToDiff: { [baseVersion: number]: number[]; };
}

/**
 * Disk cache is not talking over the network, and provides read/write access
 * method to cache files.
 */
export interface CacheFiles {
	
	/**
	 * @param objId
	 * @return a promise, resolvable to object's status info, or to
	 * undefined, if object is not present in cache.
	 */
	findObj(objId: string): Promise<ObjStatusInfo>;
	
	/**
	 * @param objId
	 * @param version specifying required object version
	 * @return a promise, resolvable to object's caching progress,
	 * if object is being downloaded, and to undefined, otherwise.
	 */
	cachingProgressFor(objId: string, version: number):
		Promise<CachingProgress>;
	
	/**
	 * @param objId
	 * @param version specifying required object version
	 * @return a promise, resolvable to object header bytes
	 */
	readObjHeader(objId: string, version: number): Promise<Uint8Array>;
	
	/**
	 * @param objId
	 * @param version
	 * @param start
	 * @param end
	 * @return a promise, resolvable to a byte array, read from object segments.
	 * Note that, if this is a diff-ed version, these will be bytes from a new
	 * byte array, which may not correspond to proper version bytes, as proper
	 * version includes bytes from a base version.
	 */
	readObjSegments(objId: string, version: number, start: number,
		end: number): Promise<Uint8Array>;
	
	/**
	 * @param objId
	 * @param version specifying required object version
	 * @return a promise, resolvable to object's diff, if object version is
	 * defined via diff, and to undefined, otherwise.
	 */
	readObjDiff(objId: string, version: number): Promise<DiffInfo>;
	
	/**
	 * @param objId
	 * @param version
	 * @param countBase if version is recorded as a diff, this flag's true
	 * (default) value, ensures that relevant base bytes are accounted for.
	 * Otherwise, false value, ensures that only new to this version bytes
	 * are accounted for.  
	 * @return a promise, resolvable to a segments length of given object
	 * version in cache.
	 */
	getSegsSize(objId: string, version: number, countBase?: boolean):
		Promise<number>;
	
	/**
	 * @param objId
	 * @param version
	 * @param header is a complete header byte array
	 * @param segsSize
	 * @param isCurrent if true, will set this given version as current,
	 * otherwise set as archived
	 * @return a promise, resolvable when given header bytes are saved as a start
	 * in saving the object
	 */
	startCachingObj(objId: string, version: number, header: Uint8Array,
			segsSize: number, isCurrent: boolean): Promise<CachingProgress>;
	
	/**
	 * @param objId
	 * @param version
	 * @param offset is an offset into segments from where writting should start
	 * @param bytes is segments' chunk
	 * @return a promise, resolvable when given segment chunk is saved
	 */
	cacheObjSegments(objId: string, version: number, offset: number,
		bytes: Uint8Array): Promise<CachingProgress>;

	removeObj(objId: string): Promise<void>;

	removeArchivedObjVersion(objId: string, version: number): Promise<void>;

	saveObj(objId: string, src: ObjSource): Promise<void>;

	saveDiff(objId: string, version: number, diff: DiffInfo,
		header: Uint8Array, newSegs?: Uint8Array): Promise<void>;

	syncLogFor(objId: string): Promise<SyncLog>;

	setSyncLog(objId: string, log: SyncLog): Promise<void>;
	
	clearSyncLog(objId: string): Promise<void>;

	garbageCollect(objId: string, version?: number): void;
	
}

type RmFlag = 'version-files' | 'whole-folder';

/**
 * This is a catch callback, which returns undefined on file(folder) not found
 * exception, and re-throws all other exceptions/errors.
 */
function noFileOrReThrow(exc: FileException): void {
	if (!exc.notFound) { throw exc; }
}

function checkToOkCacheMove(objFolderList: ListingEntry[]): boolean {
	for (let entity of objFolderList) {
		if (entity.name === SYNC_UPLOAD_FILE_NAME) { return false; }
	}
	return true;
}

/**
 * @param u is an unsigned integer (up to 40-bit) to be stored littleendian
 * way in 5 bytes.
 * @return a byte array with number stored in it.
 */
function uintTo5Bytes(u: number): Uint8Array {
	if (u >= 0x10000000000) { throw new Error(
		'Cannot store number bigger than 2^40-1'); }
	let x = new Buffer(5);
	x[0] = (u / 0x100000000) | 0;
	x[1] = u >>> 24;
	x[2] = u >>> 16;
	x[3] = u >>> 8;
	x[4] = u;
	return x;
}

/**
 * @param x
 * @param i
 * @return unsigned integer (up to 40 bits), stored littleendian way
 * in 5 bytes of x, starting at index i.
 */
function uintFrom5Bytes(x: Uint8Array, i = 0): number {
	if (x.length < i+5) { throw new Error(
		'Given array has less than 5 bytes, starting with a given index.'); }
	var l = (x[1] << 24) | (x[2] << 16) | (x[3] << 8) | x[4];
	return (x[0] * 0x100000000) + l;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) { return false; }
	for (let i=0; i < a.length; i+=1) {
		if (a[i] !== b[i]) { return false; }
	}
	return true;
}

/**
 * @param status into which a link between versions should be added
 * @param diffVer
 * @param baseVer
 */
function addBaseToDiffLinkInStatus(status: ObjStatusInfo,
		diffVer: number, baseVer: number): void {
	if (diffVer <= baseVer) { throw new Error(`Given diff version ${diffVer} is not greater than base version ${baseVer}`); }
	let diffs = status.baseToDiff[baseVer];
	if (diffs) {
		if (diffs.indexOf(diffVer) < 0) {
			diffs.push(diffVer);
		}
	} else {
		status[baseVer] = [ diffVer ];
	}
}

/**
 * @param status from which a link between versions should be removed
 * @param diffVer
 * @param baseVer
 * @return true, if link was found and removed (i.e. status has changed).
 * Otherwise, false is returned (i.e. status hasn't changed).
 */
function rmBaseToDiffLinkFromStatus(status: ObjStatusInfo,
		diffVer: number, baseVer: number): boolean {
	let diffs = status.baseToDiff[baseVer];
	if (!diffs) { return false; }
	let diffInd = diffs.indexOf(diffVer);
	if (diffInd < 0) { return false; }
	diffs.splice(diffInd, 1);
	if (diffs.length === 0) {
		delete status.baseToDiff[baseVer];
	}
	return true;
}

/**
 * This class keeps files on the disk cache.
 * It is provides methods to read/write objects to/from disk. 
 */
export class StorageFiles implements CacheFiles {
	
	private cache: CacheOfFolders = null;
	private objStatus = new TimeWindowCache<string, ObjStatusInfo>(60*1000);
	logsCache = new TimeWindowCache<string, SyncLog>(60*1000);
	
	constructor(
			private fs: FS) {
		Object.seal(this);
	}
	
	async init(): Promise<void> {
		this.cache = new CacheOfFolders(this.fs, checkToOkCacheMove);
		Object.freeze(this);
		await this.cache.init(CACHE_ROTATION_HOURS);
	}

	/**
	 * @param objId
	 * @param throwIfMissing is a flag, which true value forces throwing cache
	 * exception when object is not found. Default value is true.
	 * @return a promise, resolvable to object's folder path, when object is
	 * found in cache, and to undefined, when it is not found.
	 */
	private getObjFolder(objId: string, throwIfMissing = true): Promise<string> {
		if (objId === null) {
			objId = ROOT_OBJ_DIR;
		}
		objId = objId.toLowerCase();
		return this.cache.getFolder(objId).catch((exc: CacheExc) => {
			if (!exc.notFound || throwIfMissing) { throw exc; }
		});
	}
	
	/**
	 * @param objId
	 * @return a promise, resolvable to object's folder path, when object is
	 * either found or created in cache.
	 */
	private getOrMakeObjFolder(objId: string): Promise<string> {
		if (objId === null) {
			objId = ROOT_OBJ_DIR;
		}
		objId = objId.toLowerCase();
		return this.cache.getOrMakeFolder(objId);
	}

	/**
	 * @param objId of an object, which folder should be completely removed
	 * @return a promise, resolvable, when object folder is removed.
	 */
	private removeObjFolder(objId: string): Promise<void> {
		if (objId === null) { throw new Error('Cannot remove root object'); }
		objId = objId.toLowerCase();
		return this.cache.removeFolder(objId);
	}

	/**
	 * @param thisArg is a user of this cache
	 * @param method is cache user's method, that should be synced and bind.
	 * Synchronization is done via chaining every execution under object id,
	 * which must be the first parameter of each invocation.
	 */
	syncAndBind<T extends Function>(thisArg: any, method: T): T {
		return <T> <any> ((...args: any[]) => {
			let objId = args[0];
			return this.cache.folderProcs.startOrChain<Uint8Array>(objId, () => {
				return method.apply(thisArg, args);
			});
		});
	}

	private async getObjStatus(objFolder: string): Promise<ObjStatusInfo> {
		let status = this.objStatus.get(objFolder);
		if (status) { return status; }
		return this.fs.readJSONFile<ObjStatusInfo>(
			`${objFolder}/${STATUS_FILE_NAME}`);
	}

	private async setObjStatus(objFolder: string, status: ObjStatusInfo):
			Promise<void> {
		this.objStatus.set(objFolder, status);
		await this.fs.writeJSONFile(`${objFolder}/${STATUS_FILE_NAME}`, status);
	}

	/**
	 * @param path
	 * @return a promise, resolvable to true, if file starts as diff file, or to
	 * false, if it starts as all bytes file. All other cases throw up.
	 */
	private async isDiffFile(path: string): Promise<boolean> {
		let firstThree = await this.fs.readBytes(path, 0, 3);
		if (bytesEqual(firstThree, ALL_BYTES_FILE_START)) {
			return false;
		} else if (bytesEqual(firstThree, DIFF_BYTES_FILE_START)) {
			return true;
		} else {
			throw new Error(`First bytes of file ${path} correspond neither to all bytes file, nor to diff file`);
		}
	}

	/**
	 * @param path
	 * @return a promise, resolvable to diff info, if given file is a diff, to
	 * undefined, if given file has all bytes. If file is neither type, this
	 * throws up.
	 */
	private async parseDiffFrom(path: string): Promise<DiffInfo> {
		let isDiffFile = await this.isDiffFile(path);
		if (!isDiffFile) { return; }
		let headerOffsetBytes = await this.fs.readBytes(path, 3, 8);
		let headerStart = uintFrom5Bytes(headerOffsetBytes);
		let bytesWithDiff = await this.fs.readBytes(path, 13, headerStart);
		try {
			return <DiffInfo> JSON.parse(toBuffer(bytesWithDiff).toString('utf8'));
		} catch (err) {
			throw errWithCause(err, `Cannot parse diff from file ${path}`);
		}
	}

	async findObj(objId: string): Promise<ObjStatusInfo> {
		let objFolder = await this.getObjFolder(objId, false);
		if (!objFolder) { return; }
		return this.getObjStatus(objFolder).catch(noFileOrReThrow);
	}
	
	async readObjSegments(objId: string, version: number, start: number,
			end: number): Promise<Uint8Array> {
		let objFolder = await this.getObjFolder(objId);
		let path = `${objFolder}/${version}.`;
		let isDiffFile = await this.isDiffFile(path);
		let offset = uintFrom5Bytes(await this.fs.readBytes(path,
			(isDiffFile ? 8 : 3), (isDiffFile ? 13 : 8)));
		return this.fs.readBytes(path, start+offset, end+offset);
	}
	

	async getSegsSize(objId: string, version: number, countBase = true):
			Promise<number> {
		let objFolder = await this.getObjFolder(objId);
		let path = `${objFolder}/${version}.`;
		let diff = await this.parseDiffFrom(path);
		if (countBase && diff) {
			return diff.segsSize;
		} else {
			let segsStart = uintFrom5Bytes(await this.fs.readBytes(path, 3, 8));
			let stats = await this.fs.statFile(path);
			return stats.size - segsStart;
		}
	}
	
	async readObjHeader(objId: string, version: number): Promise<Uint8Array> {
		let objFolder = await this.getObjFolder(objId);
		let path = `${objFolder}/${version}.`;
		let isDiffFile = await this.isDiffFile(path);
		let start = (isDiffFile ?
			uintFrom5Bytes(await this.fs.readBytes(path, 3, 8)) :
			8);
		let end = uintFrom5Bytes(await this.fs.readBytes(path,
			(isDiffFile ? 8 : 3), (isDiffFile ? 13 : 8)));
		return this.fs.readBytes(path, start, end);
	}
	
	garbageCollect(objId: string, version: number = null): void {
		this.cache.folderProcs.startOrChain<void>(objId, async () => {
			let objFolder = await this.getObjFolder(objId, false);
			if (!objFolder) { return; }
			let okToRm = await this.canRemoveObjVersion(objFolder, version);
			if (okToRm === 'whole-folder') {
				await this.removeObjFolder(objId);
			} else if (okToRm === 'version-files') {
				await this.rmObjVersion(objFolder, version);
			}
		});
	}

	/**
	 * @param objFolder
	 * @param version of a particular version. If NaN-thing is given, then check
	 * only determines whether object folder can be removed. 
	 * @return a promise, resolvable to string 'version-files', when only version
	 * files can be removed, to string 'whole-folder', when whole object folder
	 * can be removed, and to undefined, when no removal can be done.
	 */
	async canRemoveObjVersion(objFolder: string, version: number):
			Promise<RmFlag> {
		let status = await this.getObjStatus(objFolder).catch(noFileOrReThrow);
		if (status) {
			if (status.currentVersion === version) { return; }
			let arch = status.archivedVersions;
			if (Array.isArray(arch) && (arch.indexOf(version) >= 0)) { return; }
		}
		let log = this.logsCache.get(objFolder);
		if (!log) {
			log = await this.fs.readJSONFile<SyncLog>(
				`${objFolder}/${SYNC_UPLOAD_FILE_NAME}`).catch(noFileOrReThrow);
		}
		if (log) {
			if (log.currentAction &&
					(log.currentAction.version === version)) { return; }
			for (let action of log.backlog) {
				if (action.deleteArchivedVersion || action.deleteObj) { continue; }
				if (action.version === version) { return; }
			}
		}
		// at this point we know that files can be removed
		let flag: RmFlag = ((typeof version === 'number') ?
			'version-files' : undefined);
		if (status) {
			if (typeof status.currentVersion === 'number') { return flag; }
			let arch = status.archivedVersions;
			if (Array.isArray(arch) && (arch.length > 0)) { return flag; }
		}
		if (log) {
			if (log.currentAction) { return flag; }
			if (log.backlog.length > 0) { return flag; }
		}
		// at this point we know that whole folder can be removed
		flag = 'whole-folder';
		return flag;
	}

	private async rmObjVersion(objFolder: string, version: number):
			Promise<void> {
		// skip removal if this version is base for some other diff
		let status = await this.getObjStatus(objFolder).catch(noFileOrReThrow);
		if (status.baseToDiff[version]) { return; } 

		// do removal
		let lst = await this.fs.listFolder(objFolder);
		let verStr = `${version}.`;
		for (let entity of lst) {
			let fName = entity.name;
			if (!fName.startsWith(verStr)) { continue; }
			if (fName === verStr) {
				let diff = await this.parseDiffFrom(`${objFolder}/${fName}`);
				if (diff) {
					// trigger garbage collection on diff's base  
					if (rmBaseToDiffLinkFromStatus(status,
							version, diff.baseVersion)) {
						await this.setObjStatus(objFolder, status);
					}
					if (status.baseToDiff[diff.baseVersion]) {
						this.garbageCollect(status.objId, diff.baseVersion);
					}
				}
			}
			await this.fs.deleteFile(`${objFolder}/${fName}`);
		}
	}

	async startCachingObj(objId: string, version: number, header: Uint8Array,
			segsSize: number, isCurrent: boolean): Promise<CachingProgress> {
		let objFolder = await this.getOrMakeObjFolder(objId);
		let status = await this.getObjStatus(objFolder).catch(noFileOrReThrow);
		let verToRemove: number;
		if (status) {
			let arch = status.archivedVersions;
			if ((status.currentVersion === version) ||
					(Array.isArray(arch) && (arch.indexOf(version) >= 0))) {
				console.warn(`Attempting to start caching object ${objId} version ${version}, when it is already registered in a status file.`);
				return;
			}
			if (isCurrent) {
				if (typeof status.currentVersion === 'number') {
					verToRemove = status.currentVersion;
				}
				status.currentVersion = version;
			} else {
				if (Array.isArray(arch)) {
					arch.push(version);
				} else {
					arch = [ version ];
					status.archivedVersions = arch;
				}
			}
		} else {
			status = { objId, baseToDiff: {} };
			if (isCurrent) {
				status.currentVersion = version;
			} else {
				status.archivedVersions = [ version ];
			}
		}
		let sink = await this.fs.getByteSink(`${objFolder}/${version}.`);
		await sink.write(ALL_BYTES_FILE_START);
		let segsOffset = 8 + header.length;
		await sink.write(uintTo5Bytes(segsOffset));
		await sink.write(header);
		if (segsSize > 0) {
			await sink.setSize(segsOffset + segsSize);
		}
		let objProgress: CachingProgress = { segsSize, segs: [] };
		await this.fs.writeJSONFile(
			`${objFolder}/${version}.${CACHE_PROGRESS_FILE_EXT}`, objProgress);
		await this.setObjStatus(objFolder, status);
		if (verToRemove) { this.garbageCollect(objId, verToRemove); }
		return objProgress;
	}

	async cachingProgressFor(objId: string, version: number):
			Promise<CachingProgress> {
		let objFolder = await this.getObjFolder(objId);
		let progressFile = `${objFolder}/${version}.${CACHE_PROGRESS_FILE_EXT}`;
		let info = await this.fs.readJSONFile<CachingProgress>(progressFile)
		.catch(noFileOrReThrow);
		return info;
	}
	
	private async updateCachingProgressInfo(objFolder: string, version: number,
			objStatus: CachingProgress, start: number, end: number):
			Promise<CachingProgress> {
		mergeRegions(objStatus.segs, { start, end });
		let partialFile = `${objFolder}/${version}.${CACHE_PROGRESS_FILE_EXT}`;
		if ((objStatus.segs.length === 1) && (objStatus.segs[0].start === 0) &&
				(objStatus.segs[0].end === objStatus.segsSize)) {
			await this.fs.deleteFile(partialFile);
			objStatus.isDone = true;
		} else {
			await this.fs.writeJSONFile(partialFile, objStatus);
		}
		return objStatus;
	}
	
	async cacheObjSegments(objId: string, version: number, offset: number,
			bytes: Uint8Array): Promise<CachingProgress> {
		let objFolder = await this.getObjFolder(objId);
		let objStat = await this.fs.readJSONFile<CachingProgress>(
			`${objFolder}/${version}.${CACHE_PROGRESS_FILE_EXT}`);
		let path = `${objFolder}/${version}.`;
		let isDiff = await this.isDiffFile(path);
		let segsOffset = uintFrom5Bytes(await this.fs.readBytes(path,
			(isDiff ? 8 : 3), (isDiff ? 13 : 8)));
		let sink = await this.fs.getByteSink(path);
		sink.seek(offset+segsOffset);
		let bytesLen = bytes.length;
		await sink.write(bytes);
		return await this.updateCachingProgressInfo(
			objFolder, version, objStat, offset, offset+bytesLen);
	}

	async removeArchivedObjVersion(objId: string, version: number):
			Promise<void> {
		let objFolder = await this.getObjFolder(objId);
		let status = await this.getObjStatus(objFolder);
		let arch = status.archivedVersions;
		if (!Array.isArray(arch) || (arch.length === 0)) { return; }
		let vInd = arch.indexOf(version);
		if (vInd < 0) { throw makeNotFoundExc(`${objId}; version: ${version}`); }
		arch.splice(vInd, 1);
		await this.setObjStatus(objFolder, status);
		this.garbageCollect(objId, version);
	}
	
	async removeObj(objId: string): Promise<void> {
		let objFolder = await this.getObjFolder(objId);
		let status = await this.getObjStatus(objFolder);
		if (status.isArchived) { throw makeNotFoundExc(
			`${objId}; version: current`); }
		status.isArchived = true;
		let verToDel = status.currentVersion;
		delete status.currentVersion;
		await this.setObjStatus(objFolder, status);
		if (verToDel) { this.garbageCollect(objId, verToDel); }
	}

	private async updateStatusWhenSettingNewCurrentVersion(objId: string,
			objFolder: string, status: ObjStatusInfo, newVersion: number,
			diff?: DiffInfo): Promise<void> {
		let verToDel: number;
		if (status) {
			verToDel = status.currentVersion;
			status.currentVersion = newVersion;
		} else {
			status = {
				objId,
				currentVersion: newVersion,
				baseToDiff: {}
			};
		}
		if (diff) {
			addBaseToDiffLinkInStatus(status, newVersion, diff.baseVersion);
			if (verToDel === diff.baseVersion) { verToDel = null; }
		}
		await this.setObjStatus(objFolder, status);
		if (verToDel) { this.garbageCollect(objId, verToDel); }
	}

	async saveObj(objId: string, src: ObjSource): Promise<void> {
		let objFolder = await this.getOrMakeObjFolder(objId);
		let status = await this.getObjStatus(objFolder).catch(noFileOrReThrow);
		if (status && status.isArchived) { throw makeObjExistsExc(objId); }
		let version = src.getObjVersion();

		// write all-bytes file
		let sink = await this.fs.getByteSink(`${objFolder}/${version}.`);
		await sink.write(ALL_BYTES_FILE_START);
		let header = await src.readHeader();
		let segsOffset = 8 + header.length;
		await sink.write(uintTo5Bytes(segsOffset));
		await sink.write(header);
		await pipe(src.segSrc, sink, true);

		// set status
		await this.updateStatusWhenSettingNewCurrentVersion(
			objId, objFolder, status, version);
	}

	private async versionFileExists(objFolder: string, version: number):
			Promise<boolean> {
		return this.fs.checkFilePresence(`${objFolder}/${version}.`);
	}

	async readObjDiff(objId: string, version: number): Promise<DiffInfo> {
		let objFolder = await this.getObjFolder(objId);
		return this.parseDiffFrom(`${objFolder}/${version}.`);
	}

	async saveDiff(objId: string, version: number, diff: DiffInfo,
			header: Uint8Array, newSegs?: Uint8Array): Promise<void> {
		let objFolder = await this.getObjFolder(objId);
		let status = await this.getObjStatus(objFolder).catch(noFileOrReThrow);
		if (status && status.isArchived) { throw makeObjExistsExc(objId); }
		if (!(this.versionFileExists(objFolder, diff.baseVersion))) {
			throw new Error(`Object ${objId}, diff's base version ${diff.baseVersion} file is not found.`);
		}

		// write diff file
		let diffBytes = new Buffer(JSON.stringify(diff), 'utf8');
		let sink = await this.fs.getByteSink(`${objFolder}/${version}.`);
		await sink.write(DIFF_BYTES_FILE_START);
		let headerOffset = 13 + diffBytes.length;
		await sink.write(uintTo5Bytes(headerOffset));
		let segsOffset = headerOffset + header.length;
		await sink.write(uintTo5Bytes(segsOffset));
		await sink.write(diffBytes);
		await sink.write(header);
		if (newSegs) {
			await sink.write(newSegs);
		}
		await sink.write(null);

		// set status
		await this.updateStatusWhenSettingNewCurrentVersion(
			objId, objFolder, status, version, diff);
	}

	async syncLogFor(objId: string): Promise<SyncLog> {
		let objFolder = await this.getObjFolder(objId, false);
		if (!objFolder) { return; }
		let log = await this.fs.readJSONFile<SyncLog>(
			`${objFolder}/${SYNC_UPLOAD_FILE_NAME}`).catch(noFileOrReThrow);
		if (log) { this.logsCache.set(objFolder, log); }
		return log;
	}

	async setSyncLog(objId: string, log: SyncLog): Promise<void> {
		let objFolder = await this.getOrMakeObjFolder(objId);
		let transFile = `${objFolder}/${SYNC_UPLOAD_FILE_NAME}`;
		await this.fs.writeJSONFile(transFile, log);
		this.logsCache.set(objFolder, log);
	}

	async clearSyncLog(objId: string): Promise<void> {
		let objFolder = await this.getObjFolder(objId);
		await this.fs.deleteFile(`${objFolder}/${SYNC_UPLOAD_FILE_NAME}`)
		.catch(noFileOrReThrow);
		this.logsCache.delete(objFolder);
	}

	wrap(): CacheFiles {
		let w: CacheFiles = {
			findObj: this.syncAndBind(this, this.findObj),
			readObjSegments: this.syncAndBind(this, this.readObjSegments),
			getSegsSize: this.syncAndBind(this, this.getSegsSize),
			readObjHeader: this.syncAndBind(this, this.readObjHeader),
			cachingProgressFor: this.syncAndBind(this,
				this.cachingProgressFor),
			startCachingObj: this.syncAndBind(this, this.startCachingObj),
			cacheObjSegments: this.syncAndBind(this, this.cacheObjSegments),
			removeObj: this.syncAndBind(this, this.removeObj),
			removeArchivedObjVersion: this.syncAndBind(this,
				this.removeArchivedObjVersion),
			saveObj: this.syncAndBind(this, this.saveObj),
			readObjDiff: this.syncAndBind(this, this.readObjDiff),
			saveDiff: this.syncAndBind(this, this.saveDiff),
			syncLogFor: this.syncAndBind(this, this.syncLogFor),
			setSyncLog: this.syncAndBind(this, this.setSyncLog),
			clearSyncLog: this.syncAndBind(this, this.clearSyncLog),
			garbageCollect: bind(this, this.garbageCollect)
		};
		Object.freeze(w);
		return w;
	}
	
}
Object.freeze(StorageFiles.prototype);
Object.freeze(StorageFiles);

export async function makeCacheParts(fs: FS, remoteStorage: RemoteStorageOwner):
	Promise<{ files: CacheFiles; down: Downloader; up: Uploader; }> {
	let storageFiles = new StorageFiles(fs);
	await storageFiles.init();
	let files = storageFiles.wrap();
	let up = new Uploader(files, storageFiles.logsCache, remoteStorage);
	let down = new Downloader(files, remoteStorage);
	return { files, down, up };
}

Object.freeze(exports);