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

import { SingleProc, sleep } from '../../../lib-common/processes';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { FileException } from '../../../lib-common/exceptions/file';
import { pipe } from '../../../lib-common/byte-streaming/pipe';
import { makeObjExistsExc } from '../../../lib-client/3nstorage/exceptions';
import { TimeWindowCache } from '../../../lib-common/time-window-cache';
import { DiffInfo } from '../../../lib-common/service-api/3nstorage/owner';
import { bind } from '../../../lib-common/binding';
import { makeNotFoundExc }
	from '../../../lib-client/local-files/generational-cache';
import { parseObjFileOffsets, writeObjTo, parseDiffAndOffsets }
	from '../../../lib-client/obj-file-on-dev-fs';

export { DiffInfo, addDiffSectionTo }
	from '../../../lib-common/service-api/3nstorage/owner';

const ROOT_OBJ_DIR = '=root=';
const STATUS_FILE_NAME = 'status';
const SPLITS_FILE = 'splits.json';

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
	const diffs = status.baseToDiff[baseVer];
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
	const base = status.diffToBase[ver];
	if (typeof base !== 'number') { return; }
	delete status.diffToBase[ver];
	const diffs = status.baseToDiff[base];
	if (!diffs) { return; }
	const diffInd = diffs.indexOf(ver);
	if (diffInd < 0) { return; }
	diffs.splice(diffInd, 1);
	if (diffs.length === 0) {
		delete status.baseToDiff[base];
		rmNonArchVersionsIn(status, base);
	}
}

/**
 * Instance of this interface provides read/write access method to object files.
 */
export interface Files {
	
	/**
	 * This returns a promise of object's status info. If object is not present
	 * in cache, promise resolves to undefined.
	 * @param objId
	 */
	findObj(objId: string): Promise<ObjStatusInfo|undefined>;
	
	/**
	 * This returns a promise of object header bytes
	 * @param objId
	 * @param version specifying required object version
	 */
	readObjHeader(objId: string, version: number): Promise<Uint8Array>;
	
	/**
	 * This returns a promise of a byte array, read from object segments.
	 * Note that, if this is a diff-ed version, these will be bytes from a new
	 * byte array, which may not correspond to proper version bytes, as proper
	 * version includes bytes from a base version.
	 * @param objId
	 * @param version
	 * @param start
	 * @param end
	 */
	readObjSegments(objId: string, version: number, start: number,
		end: number): Promise<Uint8Array|undefined>;
	
	/**
	 * This returns a promise, resolvable to object's diff, if object version is
	 * defined via diff, and to undefined, otherwise.
	 * @param objId
	 * @param version specifying required object version
	 */
	readObjDiff(objId: string, version: number): Promise<DiffInfo|undefined>;
	
	/**
	 * This returns a promise of a segments length of given object
	 * version.
	 * @param objId
	 * @param version
	 * @param countBase if version is recorded as a diff, this flag's true
	 * (default) value, ensures that relevant base bytes are accounted for.
	 * Otherwise, false value, ensures that only new to this version bytes
	 * are accounted for.  
	 */
	getSegsSize(objId: string, version: number, countBase?: boolean):
		Promise<number>;
	
	removeObj(objId: string): Promise<void>;

	removeArchivedObjVersion(objId: string, version: number): Promise<void>;

	saveObj(objId: string, src: ObjSource): Promise<void>;

	saveDiff(objId: string, version: number, diff: DiffInfo,
		header: Uint8Array, newSegs?: Uint8Array): Promise<void>;

}

export interface FileGC {

	scheduleCollection(objId: string);

}

function addWithBases(nonGarbage: Set<number>, ver: number|undefined,
		status: ObjStatusInfo): void {
	while (typeof ver === 'number') {
		nonGarbage.add(ver);
		ver = status.diffToBase[ver];
	}
}

function nonGarbageVersions(status: ObjStatusInfo): Set<number> {
	const nonGarbage = new Set<number>();
	addWithBases(nonGarbage, status.currentVersion, status);
	for (const archVer of status.archivedVersions) {
		addWithBases(nonGarbage, archVer, status);
	}
	return nonGarbage;
}

const SLEEP_BEFORE_FIRST_GC = 5000;

type WritableFS = web3n.files.WritableFS;

class GC implements FileGC {

	/**
	 * All gc steps are done in this process.
	 */
	private gcProc = new SingleProc();

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
			private fs: WritableFS,
			private files: FilesOnDisk) {
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
		const objId = this.wip.values().next().value;
		this.wip.delete(objId);
		const objFolder = await this.files.getObjFolder(objId, false);
		if (!objFolder) { return; }
		const status = await this.files.getObjStatus(objFolder).catch(
			noFileOrReThrow);
		if (!status) { return; }

		// calculate versions that should not be removed
		const nonGarbage = nonGarbageVersions(status);

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
		const fEntries = await this.fs.listFolder(objFolder);
		const rmProcs: Promise<void>[] = [];
		for (const f of fEntries) {
			const ver = parseInt(f.name);
			if (isNaN(ver) || nonGarbage.has(ver)) { continue; }
			rmProcs.push(this.fs.deleteFile(`${objFolder}/${f.name}`));
		}
		await Promise.all(rmProcs);
		return this.startNext();
	}

}

const CHARS_IN_SPLIT = 3;

class ObjFolders {

	private splits = 0;

	constructor() {
		Object.seal(this);
	}

	async init(localFS: WritableFS): Promise<void> {
		this.splits = await localFS.readJSONFile<number>(SPLITS_FILE)
		.catch((exc: FileException) => {
			if (exc.notFound) { return 0; }
			throw exc;
		});
	}

	async initFolder(localFS: WritableFS, splits: number): Promise<void> {
		if ((await localFS.listFolder('.')).length > 0) { throw new Error(
			`Folder for a new local storage is not empty.`); }
		if ((typeof splits !== 'number') || (splits < 0)) { throw new Error(
			`Illegal splits parameter given: ${splits}`); }
		if (splits === 0) { return; }
		this.splits = splits;
		await localFS.writeJSONFile(SPLITS_FILE, this.splits);
	}

	idToPath(objId: string|null): string {
		if (objId === null) { return ROOT_OBJ_DIR; }
		if (this.splits === 0) { return objId.toLowerCase(); }
		objId = objId.toLowerCase();
		const path: string[] = [];
		for (let i=0; i<this.splits; i+=1) {
			path.push(objId.substring(i*CHARS_IN_SPLIT, (i+1)*CHARS_IN_SPLIT));
		}
		path.push(objId.substring(this.splits*CHARS_IN_SPLIT));
		return path.join('/');
	}

}
Object.freeze(ObjFolders.prototype);
Object.freeze(ObjFolders);

/**
 * This class keeps files on the disk.
 */
class FilesOnDisk implements Files {
	
	private fs: WritableFS = (undefined as any);
	private objFolder = new ObjFolders();
	private objStatus = new TimeWindowCache<string, ObjStatusInfo>(60*1000);
	private gc: GC = (undefined as any);
	
	constructor() {
		Object.seal(this);
	}
	
	async init(fs: WritableFS): Promise<void> {
		this.fs = fs;
		this.gc = new GC(this.fs, this);
		const initFirstTime = ((await fs.listFolder('.')).length === 0);
		if (initFirstTime) {
			await this.objFolder.initFolder(fs, 3);
		} else {
			this.objFolder.init(fs);
		}
	}

	/**
	 * This checks that object's folder exsts on a disk. It returns a promise
	 * of folder's path.
	 * @param objId
	 * @param throwIfMissing is a flag, which true value forces throwing an
	 * exception when object is not found. Default value is true.
	 */
	async getObjFolder(objId: string, throwIfMissing = true):
			Promise<string|undefined> {
		const objFolder = this.objFolder.idToPath(objId);
		const exists = await this.fs.checkFolderPresence(objFolder).catch(
			(exc: FileException) => {
				if (!exc.notFound) { throw exc; }
				if (throwIfMissing) {
					throw makeNotFoundExc(`${objId}; version: current`);
				} else {
					return undefined;
				}
			});
		return (exists ? objFolder : undefined);
	}
	
	/**
	 * This either finds, or creates object's folder, returning a promise of its
	 * path.
	 * @param objId
	 */
	private async getOrMakeObjFolder(objId: string): Promise<string> {
		const objFolder = this.objFolder.idToPath(objId);
		await this.fs.makeFolder(objFolder);
		return objFolder;
	}

	async getObjStatus(objFolder: string): Promise<ObjStatusInfo> {
		const status = this.objStatus.get(objFolder);
		if (status) { return status; }
		return this.fs.readJSONFile<ObjStatusInfo>(
			`${objFolder}/${STATUS_FILE_NAME}`);
	}

	private async setObjStatus(objFolder: string, status: ObjStatusInfo):
			Promise<void> {
		this.objStatus.set(objFolder, status);
		await this.fs.writeJSONFile(`${objFolder}/${STATUS_FILE_NAME}`, status);
	}

	async findObj(objId: string): Promise<ObjStatusInfo|undefined> {
		const objFolder = await this.getObjFolder(objId, false);
		if (!objFolder) { return; }
		return this.getObjStatus(objFolder).catch(noFileOrReThrow);
	}
	
	async readObjSegments(objId: string, version: number, start: number,
			end: number): Promise<Uint8Array|undefined> {
		const objFolder = await this.getObjFolder(objId);
		const path = `${objFolder}/${version}.`;
		const { segsOffset } = await parseObjFileOffsets(this.fs, path);
		return await this.fs.readBytes(path, start+segsOffset, end+segsOffset);
	}
	
	async getSegsSize(objId: string, version: number, countBase = true):
			Promise<number> {
		const objFolder = await this.getObjFolder(objId);
		const path = `${objFolder}/${version}.`;
		const { segsOffset, diff } = await parseDiffAndOffsets(this.fs, path);
		if (countBase && diff) {
			return diff.segsSize;
		} else {
			const stats = await this.fs.stat(path);
			if (typeof stats.size !== 'number') { throw new Error(
				`Stat of file on disk didn't return a numeric size.`); }
			return stats.size - segsOffset;
		}
	}
	
	async readObjHeader(objId: string, version: number): Promise<Uint8Array> {
		const objFolder = await this.getObjFolder(objId);
		const path = `${objFolder}/${version}.`;
		const { headerOffset, segsOffset } =
			await parseObjFileOffsets(this.fs, path);
		const header = await this.fs.readBytes(path, headerOffset, segsOffset);
		if (!header || (header.length < (segsOffset - headerOffset))) {
			throw new Error(`Object file ${path} is too short.`); }
		return header;
	}

	async removeArchivedObjVersion(objId: string, version: number):
			Promise<void> {
		const objFolder = (await this.getObjFolder(objId))!;
		const status = await this.getObjStatus(objFolder);
		const arch = status.archivedVersions;
		const vInd = arch.indexOf(version);
		if (vInd >= 0) {
			arch.splice(vInd, 1);
			rmNonArchVersionsIn(status, version);
			await this.setObjStatus(objFolder, status);
		}
		this.gc.scheduleCollection(objId);
	}
	
	async removeObj(objId: string): Promise<void> {
		const objFolder = (await this.getObjFolder(objId))!;
		const status = await this.getObjStatus(objFolder);
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
		const objFolder = await this.getOrMakeObjFolder(objId);
		const status = await this.getObjStatus(objFolder).catch(noFileOrReThrow);
		if (status && status.isArchived) { throw makeObjExistsExc(objId); }
		const version = src.version;

		// write all-bytes file
		const sink = await this.fs.getByteSink(`${objFolder}/${version}.`);
		const header = await src.readHeader();
		await writeObjTo(sink, undefined, header);
		await pipe(src.segSrc, sink);

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
		const objFolder = await this.getObjFolder(objId);
		const { diff } =
			await parseDiffAndOffsets(this.fs, `${objFolder}/${version}.`);
		return diff;
	}

	async saveDiff(objId: string, version: number, diff: DiffInfo,
			header: Uint8Array, newSegs?: Uint8Array): Promise<void> {
		const objFolder = (await this.getObjFolder(objId))!;
		const status = await this.getObjStatus(objFolder).catch(noFileOrReThrow);
		if (status && status.isArchived) { throw makeObjExistsExc(objId); }
		if (!(await this.versionFileExists(objFolder, diff.baseVersion))) {
			throw new Error(`Object ${objId}, diff's base version ${diff.baseVersion} file is not found.`);
		}

		// write diff file
		const diffBytes = new Buffer(JSON.stringify(diff), 'utf8');
		const sink = await this.fs.getByteSink(`${objFolder}/${version}.`);
		await writeObjTo(sink, diffBytes, header, newSegs, true);

		// set status
		await this.updateStatusWhenSettingNewCurrentVersion(
			objId, objFolder, status, version, diff);
	}

	wrap(): Files {
		const w: Files = {
			findObj: bind(this, this.findObj),
			getSegsSize: bind(this, this.getSegsSize),
			readObjDiff: bind(this, this.readObjDiff),
			readObjHeader: bind(this, this.readObjHeader),
			readObjSegments: bind(this, this.readObjSegments),
			removeArchivedObjVersion: bind(this, this.removeArchivedObjVersion),
			removeObj: bind(this, this.removeObj),
			saveDiff: bind(this, this.saveDiff),
			saveObj: bind(this, this.saveObj)
		};
		Object.freeze(w);
		return w;
	}

}
Object.freeze(FilesOnDisk.prototype);
Object.freeze(FilesOnDisk);

export async function makeFiles(fs: WritableFS):
		Promise<Files> {
	const f = new FilesOnDisk();
	await f.init(fs);
	return f.wrap();
}

Object.freeze(exports);