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

import { FS, ListingEntry } from '../../../lib-client/local-files/device-fs';
import { NamedProcs, SingleProc, sleep } from '../../../lib-common/processes';
import { CacheOfFolders, Exception as CacheExc, makeNotFoundExc }
	from '../../../lib-client/local-files/generational-cache';
import { ScryptGenParams } from '../../../lib-client/key-derivation';
import { ByteSource } from '../../../lib-common/byte-streaming/common';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { FileException } from '../../../lib-common/exceptions/file';
import { bind } from '../../../lib-common/binding';
import { mergeRegions } from '../../../lib-client/local-files/regions';
import { pipe } from '../../../lib-common/byte-streaming/pipe';
import { makeObjExistsExc } from '../../../lib-client/3nstorage/exceptions';
import { TimeWindowCache } from '../../../lib-common/time-window-cache';
import { StorageOwner as RemoteStorageOwner }
	from '../../../lib-client/3nstorage/service';
import { Uploader } from './uploader';
import { Downloader } from './downloader';
import { DiffInfo } from '../../../lib-common/service-api/3nstorage/owner';
import { toBuffer } from '../../../lib-common/buffer-utils';
import { errWithCause } from '../../../lib-common/exceptions/error';

export { DiffInfo, addDiffSectionTo }
	from '../../../lib-common/service-api/3nstorage/owner';

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
	version: number|undefined;
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
	archivedVersions: number[];

	/**
	 * This is a map from base version to diff-ed version(s), that use(s) base.
	 */
	baseToDiff: { [baseVersion: number]: number[]; };

	/**
	 * This is a map from diff version to base version.
	 */
	diffToBase: { [diffVersion: number]: number; };
}

/**
 * This is a catch callback, which returns undefined on file(folder) not found
 * exception, and re-throws all other exceptions/errors.
 */
function noFileOrReThrow(exc: FileException): undefined {
	if (!exc.notFound) { throw exc; }
	return;
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
function uintFrom5Bytes(x: Uint8Array, i: number): number {
	if (x.length < i+5) { throw new Error(
		'Given array has less than 5 bytes, starting with a given index.'); }
	var l = (x[i+1] << 24) | (x[i+2] << 16) | (x[i+3] << 8) | x[i+4];
	return (x[i] * 0x100000000) + l;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) { return false; }
	for (let i=0; i < a.length; i+=1) {
		if (a[i] !== b[i]) { return false; }
	}
	return true;
}

function bytesStartWith(bytes: Uint8Array, expectation: Uint8Array): boolean {
	if (bytes.length < expectation.length) { return false; }
	for (let i=0; i < expectation.length; i+=1) {
		if (bytes[i] !== expectation[i]) { return false; }
	}
	return true;
}

/**
 * This function adds base->diff link to status. Status object is changed in
 * this call.
 * @param status into which a link between versions should be added
 * @param diffVer
 * @param baseVer
 */
function addBaseToDiffLinkInStatus(status: ObjStatusInfo,
		diffVer: number, baseVer: number): void {
	if (diffVer <= baseVer) { throw new Error(`Given diff version ${diffVer} is not greater than base version ${baseVer}`); }
	status.diffToBase[diffVer] = baseVer;
	let diffs = status.baseToDiff[baseVer];
	if (diffs) {
		if (diffs.indexOf(diffVer) < 0) {
			diffs.push(diffVer);
		}
	} else {
		status.baseToDiff[baseVer] = [ diffVer ];
	}
}

/**
 * This function removes given version from status object, if it is neither
 * archived, nor is a base for another version. If given version is itself
 * based on another, this function is recursively applied to base version, as
 * well.
 * @param status in which version(s) should be removed
 * @param ver
 */
function rmNonArchVersionsIn(status: ObjStatusInfo, ver: number): void {
	if (status.archivedVersions.indexOf(ver) >= 0) { return; }
	if (status.baseToDiff[ver]) { return; }
	let base = status.diffToBase[ver];
	if (typeof base !== 'number') { return; }
	delete status.diffToBase[ver];
	let diffs = status.baseToDiff[base];
	if (!diffs) { return; }
	let diffInd = diffs.indexOf(ver);
	if (diffInd < 0) { return; }
	diffs.splice(diffInd, 1);
	if (diffs.length === 0) {
		delete status.baseToDiff[base];
		rmNonArchVersionsIn(status, base);
	}
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
	findObj(objId: string): Promise<ObjStatusInfo|undefined>;
	
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
		end: number): Promise<Uint8Array|undefined>;
	
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

	gc: FileGC;
	
}

export interface FileGC {

	scheduleCollection(objId: string);

}

/**
 * This provides access synchronization logs for objects.
 */
export interface SyncLogs {

	get(objId: string): Promise<SyncLog>;

	set(objId: string, log: SyncLog): Promise<void>;
	
	clear(objId: string): Promise<void>;

}

function addWithBases(nonGarbage: Set<number>, ver: number|undefined,
		status: ObjStatusInfo): void {
	while (typeof ver === 'number') {
		nonGarbage.add(ver);
		ver = status.diffToBase[ver];
	}
}

function nonGarbageVersions(status: ObjStatusInfo,
		syncLog: SyncLog|undefined): Set<number> {
	let nonGarbage = new Set<number>();
	addWithBases(nonGarbage, status.currentVersion, status);
	for (let archVer of status.archivedVersions) {
		addWithBases(nonGarbage, archVer, status);
	}
	if (syncLog) {
		if (syncLog.currentAction &&
				(typeof syncLog.currentAction.version === 'number')) {
			nonGarbage.add(syncLog.currentAction.version)
		}
		for (let action of syncLog.backlog) {
			if (typeof action.version === 'number') {
				nonGarbage.add(action.version);
			}
		}
	}
	return nonGarbage;
}

const SLEEP_BEFORE_FIRST_GC = 5000;

class GC implements FileGC {

	/**
	 * All gc steps are done in this process.
	 */
	private gcProc = new SingleProc<void>();

	/**
	 * wip are objects that are currently processed. When wip set is empty,
	 * it gets swapped with non-empty scheduled set. 
	 */
	private wip = new Set<string>();

	/**
	 * scheduled is a set for incoming ids that may need gc. It gets swapped
	 * with wip set.
	 */
	private scheduled = new Set<string>();

	constructor(
			private folderProcs: NamedProcs,
			private fs: FS,
			private files: Files) {
		Object.seal(this);
	}

	scheduleCollection(objId: string): void {
		this.scheduled.add(objId);
		if (this.gcProc.getP()) { return; }
		this.gcProc.start(async () => {
			await sleep(SLEEP_BEFORE_FIRST_GC);
			return this.startNext();
		});
	}

	private async startNext(): Promise<void> {
		if (this.wip.size === 0) {
			if (this.scheduled.size === 0) { return; }
			[ this.wip, this.scheduled ] = [ this.scheduled, this.wip ];
		}
		let objId = this.wip.values().next().value;
		this.wip.delete(objId);
		await this.folderProcs.startOrChain<void>(objId, async () => {
			let objFolder = await this.files.getObjFolder(objId, false);
			if (!objFolder) { return; }
			let status = await this.files.getObjStatus(objFolder).catch(
				noFileOrReThrow);
			if (!status) { return; }
			let syncLog = await this.files.getSyncLog(objId);

			// calculate versions that should not be removed
			let nonGarbage = nonGarbageVersions(status, syncLog);

			// if object is set archived, and there is nothing in it worth keeping,
			// whole folder can be removed
			if (status.isArchived) {
				if (nonGarbage.size === 0) {
					await this.fs.deleteFolder(objFolder, true);
					return;
				}
			}

			// for all other cases, we remove version files that are not worth
			// keeping.
			let fEntries = await this.fs.listFolder(objFolder);
			let rmProcs: Promise<void>[] = [];
			for (let f of fEntries) {
				let ver = parseInt(f.name);
				if (isNaN(ver) || nonGarbage.has(ver)) { continue; }
				rmProcs.push(this.fs.deleteFile(`${objFolder}/${f.name}`));
			}
			await Promise.all(rmProcs);
		});
		return this.startNext();
	}

	wrap(): FileGC {
		let w: FileGC = {
			scheduleCollection: bind(this, this.scheduleCollection)
		};
		Object.freeze(w);
		return w;
	}

}

/**
 * This class keeps files on the disk cache.
 * It is provides methods to read/write objects to/from disk.
 * Instances should not be used directly, but as wrapped objects. Wrapping adds
 * proper synchronization on a per-object basis.
 */
class Files implements CacheFiles {
	
	private cache: CacheOfFolders = (undefined as any);
	private objStatus = new TimeWindowCache<string, ObjStatusInfo>(60*1000);
	private logsCache = new TimeWindowCache<string, SyncLog>(60*1000);
	gc: GC = (undefined as any);
	
	constructor(
			private fs: FS) {
		Object.seal(this);
	}
	
	async init(): Promise<void> {
		this.cache = new CacheOfFolders(this.fs, checkToOkCacheMove);
		this.gc = new GC(this.cache.folderProcs, this.fs, this);
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
	getObjFolder(objId: string, throwIfMissing = true): Promise<string> {
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
	 * @param method is cache user's method, that should be synced and bind.
	 * Synchronization is done via chaining every execution under object id,
	 * which must be the first parameter of each invocation.
	 */
	private syncAndBind<T extends Function>(method: T): T {
		return <T> <any> ((...args: any[]) => {
			let objId = args[0];
			return this.cache.folderProcs.startOrChain<any>(objId, () => {
				return method.apply(this, args);
			});
		});
	}

	async getObjStatus(objFolder: string): Promise<ObjStatusInfo> {
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
	 * @param readDiff is a flag, which true value forces parsing of diff info,
	 * in diff file. Default value is false, i.e. no diff info parsing happens.
	 * @return a promise, resolvable to an object with (1) isDiff flag that says
	 * if path points to diff file, (2) diff object if it was asked to be parsed,
	 * (3) headerOffset is an object header offset in this file, (4) segsOffset
	 * is object segments offset in this file.
	 */
	async parseFileHeader(path: string, readDiff = false):
			Promise<{ isDiff: boolean; diff?: DiffInfo;
				headerOffset: number; segsOffset: number; }> {
		let h = await this.fs.readBytes(path, 0, 13);
		if (!h || (h.length < 13)) { throw new Error(
			`Object file ${path} is too short.`); }
		let isDiff: boolean;
		if (bytesStartWith(h, ALL_BYTES_FILE_START)) {
			isDiff = false;
		} else if (bytesStartWith(h, DIFF_BYTES_FILE_START)) {
			isDiff = true;
		} else {
			throw new Error(`First bytes of file ${path} correspond neither to all bytes file, nor to diff file`);
		}
		if (isDiff) {
			let headerOffset = uintFrom5Bytes(h, 3);
			let segsOffset = uintFrom5Bytes(h, 8);
			if (readDiff) {
				let diffBytes = await this.fs.readBytes(path, 13, headerOffset);
				if (!diffBytes || (diffBytes.length < (headerOffset - 13))) {
					throw new Error(`Object file ${path} is too short.`); }
				let diff = <DiffInfo> JSON.parse(
					toBuffer(diffBytes).toString('utf8'));
				return { isDiff, diff, headerOffset, segsOffset };
			} else {
				return { isDiff, headerOffset, segsOffset };
			}
		} else {
			let headerOffset = 8;
			let segsOffset = uintFrom5Bytes(h, 3);
			return { isDiff, headerOffset, segsOffset };
		}
	}

	async findObj(objId: string): Promise<ObjStatusInfo|undefined> {
		let objFolder = await this.getObjFolder(objId, false);
		if (!objFolder) { return; }
		return this.getObjStatus(objFolder).catch(noFileOrReThrow);
	}
	
	async readObjSegments(objId: string, version: number, start: number,
			end: number): Promise<Uint8Array|undefined> {
		let objFolder = await this.getObjFolder(objId);
		let path = `${objFolder}/${version}.`;
		let { segsOffset } = await this.parseFileHeader(path);
		return await this.fs.readBytes(path, start+segsOffset, end+segsOffset);
	}
	
	async getSegsSize(objId: string, version: number, countBase = true):
			Promise<number> {
		let objFolder = await this.getObjFolder(objId);
		let path = `${objFolder}/${version}.`;
		let { segsOffset, diff } = await this.parseFileHeader(path, true);
		if (countBase && diff) {
			return diff.segsSize;
		} else {
			let stats = await this.fs.statFile(path);
			return stats.size - segsOffset;
		}
	}
	
	async readObjHeader(objId: string, version: number): Promise<Uint8Array> {
		let objFolder = await this.getObjFolder(objId);
		let path = `${objFolder}/${version}.`;
		let { headerOffset, segsOffset } = await this.parseFileHeader(path);
		let header = await this.fs.readBytes(path, headerOffset, segsOffset);
		if (!header || (header.length < (segsOffset - headerOffset))) {
			throw new Error(`Object file ${path} is too short.`); }
		return header;
	}

	async startCachingObj(objId: string, version: number, header: Uint8Array,
			segsSize: number, isCurrent: boolean):
			Promise<CachingProgress> {
		let objFolder = await this.getOrMakeObjFolder(objId);
		let status = await this.getObjStatus(objFolder).catch(noFileOrReThrow);
		if (status) {
			let arch = status.archivedVersions;
			if ((status.currentVersion === version) ||
					(arch.indexOf(version) >= 0)) {
				throw new Error(`Attempting to start caching object ${objId} version ${version}, when it is already registered in a status file.`);
			}
			if (isCurrent) {
				status.currentVersion = version;
			} else {
				arch.push(version);
			}
		} else {
			status = {
				objId,
				archivedVersions: [],
				baseToDiff: {},
				diffToBase: {}
			};
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
		this.gc.scheduleCollection(objId);
		return objProgress;
	}

	async cachingProgressFor(objId: string, version: number):
			Promise<CachingProgress|undefined> {
		let objFolder = await this.getObjFolder(objId);
		let progressFile = `${objFolder}/${version}.${CACHE_PROGRESS_FILE_EXT}`;
		return this.fs.readJSONFile<CachingProgress>(progressFile)
		.catch(noFileOrReThrow);
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
		let { segsOffset } = await this.parseFileHeader(path);
		let sink = await this.fs.getByteSink(path);
		sink.seek!(offset+segsOffset);
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
		let vInd = arch.indexOf(version);
		if (vInd >= 0) {
			arch.splice(vInd, 1);
			rmNonArchVersionsIn(status, version);
			await this.setObjStatus(objFolder, status);
		}
		this.gc.scheduleCollection(objId);
	}
	
	async removeObj(objId: string): Promise<void> {
		let objFolder = await this.getObjFolder(objId);
		let status = await this.getObjStatus(objFolder);
		if (status.isArchived) { throw makeNotFoundExc(
			`${objId}; version: current`); }
		status.isArchived = true;
		if (typeof status.currentVersion === 'number') {
			rmNonArchVersionsIn(status, status.currentVersion);
			delete status.currentVersion;
		}
		await this.setObjStatus(objFolder, status);
		this.gc.scheduleCollection(objId);
	}

	private async updateStatusWhenSettingNewCurrentVersion(objId: string,
			objFolder: string, status: ObjStatusInfo|void, newVersion: number,
			diff?: DiffInfo): Promise<void> {
		if (status) {
			if (diff) {
				// base->diff links should be added before removals
				addBaseToDiffLinkInStatus(status, newVersion, diff.baseVersion);
			}
			if (typeof status.currentVersion === 'number') {
				rmNonArchVersionsIn(status, status.currentVersion);
			}
			status.currentVersion = newVersion;
		} else {
			status = {
				objId,
				currentVersion: newVersion,
				archivedVersions: [],
				diffToBase: {},
				baseToDiff: {}
			};
			if (diff) {
				addBaseToDiffLinkInStatus(status, newVersion, diff.baseVersion);
			}
		}
		await this.setObjStatus(objFolder, status);
		this.gc.scheduleCollection(objId);
	}

	async saveObj(objId: string, src: ObjSource): Promise<void> {
		let objFolder = await this.getOrMakeObjFolder(objId);
		let status = await this.getObjStatus(objFolder).catch(noFileOrReThrow);
		if (status && status.isArchived) { throw makeObjExistsExc(objId); }
		
		// XXX can we remove undefined option from object source?

		let version = src.getObjVersion();
		if (version === undefined) { throw new Error(
			`Object source is not providing object version.`); }

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

	async readObjDiff(objId: string, version: number):
			Promise<DiffInfo|undefined> {
		let objFolder = await this.getObjFolder(objId);
		let { diff } = await this.parseFileHeader(
			`${objFolder}/${version}.`, true);
		return diff;
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

	async getSyncLog(objId: string): Promise<SyncLog|undefined> {
		let log = this.logsCache.get(objId);
		if (log) { return log; }
		let objFolder = await this.getObjFolder(objId, false);
		if (!objFolder) { return; }
		try {
			let log = await this.fs.readJSONFile<SyncLog>(
				`${objFolder}/${SYNC_UPLOAD_FILE_NAME}`);
			this.logsCache.set(objFolder, log);
			return log;
		} catch (exc) {
			noFileOrReThrow(exc);
		}
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

	wrapFiles(): CacheFiles {
		let w: CacheFiles = {
			findObj: this.syncAndBind(this.findObj),
			readObjSegments: this.syncAndBind(this.readObjSegments),
			getSegsSize: this.syncAndBind(this.getSegsSize),
			readObjHeader: this.syncAndBind(this.readObjHeader),
			cachingProgressFor: this.syncAndBind(this.cachingProgressFor),
			startCachingObj: this.syncAndBind(this.startCachingObj),
			cacheObjSegments: this.syncAndBind(this.cacheObjSegments),
			removeObj: this.syncAndBind(this.removeObj),
			removeArchivedObjVersion: this.syncAndBind(
				this.removeArchivedObjVersion),
			saveObj: this.syncAndBind(this.saveObj),
			readObjDiff: this.syncAndBind(this.readObjDiff),
			saveDiff: this.syncAndBind(this.saveDiff),
			gc: this.gc
		};
		Object.freeze(w);
		return w;
	}

	wrapSyncLogs(): SyncLogs {
		let w: SyncLogs = {
			get: this.syncAndBind(this.getSyncLog),
			set: this.syncAndBind(this.setSyncLog),
			clear: this.syncAndBind(this.clearSyncLog),
		};
		Object.freeze(w);
		return w;
	}

}
Object.freeze(Files.prototype);
Object.freeze(Files);


export async function makeCacheParts(fs: FS, remoteStorage: RemoteStorageOwner):
		Promise<{ files: CacheFiles; down: Downloader; up: Uploader; }> {
	let storageFiles = new Files(fs);
	await storageFiles.init();
	let files = storageFiles.wrapFiles();
	let syncLogs = storageFiles.wrapSyncLogs();
	let up = new Uploader(files, syncLogs, remoteStorage);
	let down = new Downloader(files, remoteStorage);
	return { files, down, up };
}

Object.freeze(exports);