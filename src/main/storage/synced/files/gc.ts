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

import { NamedProcs } from '../../../../lib-common/processes';
import { logError } from '../../../../lib-client/logging/log-to-file';
import { ObjId, Objs, objIdToFolderName, ObjStatusInfo, notFoundOrReThrow }
	from './objs';
import { LOCAL_FILE_NAME_EXT, UPLOAD_INFO_FILE_EXT } from './local-versions';
import { parseDiffAndOffsets } from '../../../../lib-client/obj-file-on-dev-fs';
import { FileException } from '../../../../lib-common/exceptions/file';
import { Subject } from 'rxjs';

type ReadonlyFS = web3n.files.ReadonlyFS;

export interface GC {
	scheduleCollection(objId: ObjId): void;
	stop(): Promise<void>;
}

// Rule #1: versions below latestSynced, not reachable from status, are garbage,
// except versions that are bases for versions in status. This includes all
// local versions lower than the current one.

// Rule #2: all files above latestSynced version are not subject to collection

export function makeGC(folderProcs: NamedProcs, objs: Objs): GC {

	const orders = new Subject<ObjId>();
	const objsWaiting = new Set<ObjId>();

	const gcProc = orders.asObservable()
	.filter(objId => !objsWaiting.has(objId))
	.do(objId => objsWaiting.add(objId))
	.delay(20)
	.flatMap(async objId => {
		objsWaiting.delete(objId);
		const fName = objIdToFolderName(objId);
		await folderProcs.startOrChain(fName, async () => {
			const objFolder = await objs.getObjFolder(objId, false);
			if (!objFolder) { return; }
			const status = await objs.getObjStatus(
				objId, objFolder).catch(notFoundOrReThrow);
			if (!status || !status.latestSynced) { return; }

			// calculate versions that should not be removed
			const { syncedVersions, statusUpdated } =
				await compileSyncedVersions(status, objFolder, objs.fs);

			// if object is set archived/removed, and there is nothing in it
			// accessable from status, whole folder can be removed
			if (status.isArchived && (syncedVersions.size === 0)) {
				await objs.removeObjFolder(objId);
				return;
			}

			// list folder, and remove files deemed unnecessary
			const fEntries = await objs.fs.listFolder(objFolder);
			const rmProcs: Promise<void>[] = [];
			for (const f of fEntries) {
				const ver = parseInt(f.name);
				if (isNaN(ver)) { continue; }
				if (status.isArchived) {
					if (syncedVersions.has(ver)
					&& f.name.endsWith('.')) { continue; }
				} else {
					if (ver > status.latestSynced) { continue; }
					if (syncedVersions.has(ver)) {
						const isLocal = f.name.endsWith(LOCAL_FILE_NAME_EXT);
						const isUpload = f.name.endsWith(UPLOAD_INFO_FILE_EXT);
						if (!isLocal && !isUpload) { continue; }
					}
				}
				const fp = `${objFolder}/${f.name}`;
				rmProcs.push(objs.fs.deleteFile(fp).catch((exc: FileException) => {
					if (!exc.notFound) {
						logError(exc, `Failed to remove file ${fp} during garbage collection in synced storage.`);
					}
				}));
			}
			await Promise.all(rmProcs);
			if (statusUpdated) {
				await objs.setObjStatus(status, objFolder);
			}
		})
	}, 3)
	.do(undefined as any, () => objsWaiting.clear())
	.retry()
	.share();

	gcProc.subscribe();

	return Object.freeze({
		scheduleCollection(objId: ObjId): void {
			orders.next(objId);
		},
		stop: () => {
			orders.complete();
			return gcProc.toPromise();
		}
	});
}

interface GCWorkInfo {
	latestBaseCheck: number;
	verToBase: { [version: number]: number; };
}

async function compileSyncedVersions(status: ObjStatusInfo, objFolder: string,
		fs: ReadonlyFS):
		Promise<{ syncedVersions: Set<number>; statusUpdated: boolean; }> {
	if (!status.latestSynced) { throw new Error(
		`This function should be used when there are synced versions`); }
	const syncedVersions = new Set<number>();
	
	let gcWorkInfo = status.gcWorkInfo as GCWorkInfo|undefined;
	if (!gcWorkInfo) {
		gcWorkInfo = { latestBaseCheck: -1, verToBase: {} };
	}

	// 1) collect all versions
	if (status.current && !status.current.isLocal) {
		syncedVersions.add(status.current.version);
	}
	if (status.archivedVersions) {
		for (const archVer of status.archivedVersions) {
			syncedVersions.add(archVer);
		}
	}

	const orderedVersions = Array.from(syncedVersions.values());
	orderedVersions.sort();

	// 2) add base versions
	let statusUpdated = false;
	for (const ver of orderedVersions) {
		statusUpdated = await addBaseOf(
			ver, gcWorkInfo, syncedVersions, objFolder, fs);
	}
	if (statusUpdated) {
		status.gcWorkInfo = gcWorkInfo;
	}

	return { syncedVersions, statusUpdated };
}

/**
 * This function checks if given version has a base version, adding it to a set
 * of all synced versions. Returned promise resolves to boolean that indicates
 * if gc work info has changed (true), or not (false).
 * Note that this function should be called on versions in increasing order
 * cause it sets latestBaseCheck field in gc work info to given version in
 * assumptions that lower versions 
 * @param ver 
 * @param gcWorkInfo 
 * @param syncedVersions 
 * @param fs 
 */
async function addBaseOf(ver: number, gcWorkInfo: GCWorkInfo,
		syncedVersions: Set<number>, objFolder: string, fs: ReadonlyFS):
		Promise<boolean> {
	// use gc work previous results
	if (ver <= gcWorkInfo.latestBaseCheck) {
		const base = gcWorkInfo.verToBase[ver];
		if (base) {
			syncedVersions.add(base);
			return addBaseOf(base, gcWorkInfo, syncedVersions, objFolder, fs);
		}
		return false;
	}

	// check file, and update gc work info
	const file = `${objFolder}/${ver}.`;
	const { diff } = await parseDiffAndOffsets(fs, file);
	if (diff) {
		const base = diff.baseVersion;
		gcWorkInfo.verToBase[ver] = base;
		syncedVersions.add(base);
		await addBaseOf(base, gcWorkInfo, syncedVersions, objFolder, fs);
	}
	// set latestBaseCheck after recursion, to allow actual file checks there
	gcWorkInfo.latestBaseCheck = ver;
	return true;
}

Object.freeze(exports);