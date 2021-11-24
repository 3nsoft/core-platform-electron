/*
 Copyright (C) 2021 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { FactoryOfFSs, reverseDomain, sysFolders } from 'core-3nweb-client-lib';
import { join, normalize } from 'path';
import { from, Observable, Observer as RxObserver, Subject } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { logError } from '../confs';
import { assert } from '../lib-common/assert';
import { FileException, readdir, stat } from '../lib-common/async-fs-node';
import { makeRuntimeException } from '../lib-common/exceptions/runtime';
import { AppManifest } from '../app-init/app-settings';
import { readManifestFromZip, unzipAppVersion, APP_ROOT_FOLDER, MANIFEST_FILE } from './unpack-zipped-app';

type Observer<T> = web3n.Observer<T>;
type ReadonlyFS = web3n.files.ReadonlyFS;
type WritableFS = web3n.files.WritableFS;
type ReadonlyFile = web3n.files.ReadonlyFile;
type FSCollection = web3n.files.FSCollection;
type StorageType = web3n.storage.StorageType;
type BundleUnpackProgress = web3n.ui.BundleUnpackProgress;
type AppInfo = web3n.ui.AppInfo;
type Platform = web3n.ui.PlatformType;

export const BUNDLED_APPS_FOLDER = normalize(join(__dirname, '..', 'apps'));

const CURRENT_FNAME = 'current';
const COMPLETE_PACKS_DIR = 'complete';
const PARTIAL_PACKS_DIR = 'partial';


export class SystemPlaces {

	constructor(
		private readonly storages: () => FactoryOfFSs
	) {
		Object.seal(this);
	}

	private async getSysFS(
		type: StorageType, folder: string
	): Promise<WritableFS> {
		const sysItems = await this.storages().getSysFSs(type);
		assert(!!sysItems.isCollection && !!sysItems.item);
		const item = await (sysItems.item as FSCollection).get(folder);
		assert(!!item && !!item.isFolder && !!item.item);
		return item!.item as WritableFS;
	}

	getAppsCodeFS(): Promise<WritableFS> {
		return this.getSysFS('synced', sysFolders.apps);
	}

	getPackagesFS(): Promise<WritableFS> {
		return this.getSysFS('synced', sysFolders.packages);
	}

	async listApps(): Promise<AppInfo[]> {
		const infos = new Map<string, AppInfo>();
		for (const info of await listInstalledApps(await this.getAppsCodeFS())) {
			infos.set(info.id, info);
		}
		for (const info of await listBundledApps()) {
			const existing = infos.get(info.id);
			if (existing) {
				existing.bundled = info.bundled;
			} else {
				infos.set(info.id, info);
			}
		}
		for (const info of await listCompletePacks(await this.getPackagesFS())) {
			const existing = infos.get(info.id);
			if (existing) {
				existing.packs = info.packs;
			} else {
				infos.set(info.id, info);
			}
		}
		return Array.from(infos.values());
	}

	async getAppInfo(id: string): Promise<AppInfo|undefined> {
		const appFolder = reverseDomain(id);
		let info = await getInstalledAppInfo(
			await this.getAppsCodeFS(), appFolder);
		const bundled = await getBundledAppInfo(id);
		if (bundled) {
			if (info) {
				info.bundled = bundled.bundled;
			} else {
				info = bundled;
			}
		}
		const packs = await getAppPacksInfo(
			await this.getPackagesFS(), appFolder);
		if (packs) {
			if (info) {
				info.packs = packs.packs;
			} else {
				info = packs;
			}
		}
		return info;
	}

	async getAppIcon(id: string): Promise<ReadonlyFile> {

		// XXX

		throw new Error("Method not implemented.");
	}

	unpackBundledWebApp(
		appDomain: string, observer: Observer<BundleUnpackProgress>
	): () => void {
		const sub = from(this.getPackagesFS())
		.pipe(
			mergeMap(packsFS => unpackBundledApp(appDomain, packsFS, 'web')),
			mergeMap(unpackProc => unpackProc)
		)
		.subscribe(observer as RxObserver<BundleUnpackProgress>);
		return () => sub.unsubscribe();
	}

	async installWebApp(
		id: string, version: string
	): Promise<void> {
		try {
			const platform: Platform = 'web';
			const pack = await (await this.getPackagesFS()).readonlySubRoot(
				completePackAppVersionFolder(id, platform,  version));
			await checkWebPackBeforeInstall(pack, id, version);
			const appsCode = await this.getAppsCodeFS();
			const current =`${appPlatformFolder(id, platform)}/${CURRENT_FNAME}`;
			if (await appsCode.checkLinkPresence(current)) {
				await appsCode.deleteLink(current);
			}
			await appsCode.link(current, pack);
		} catch (err) {
			throw makeAppInitExc(id, { errAtInstall: true }, err);
		}
	}

	async findInstalledApp(
		appDomain: string
	): ReturnType<typeof appAndManifestFrom> {
		const appsCode = await this.getAppsCodeFS();
		const appAndManifest = await findInstalledApp(appDomain, appsCode, 'web');
		return appAndManifest;
	}

	async makeDownloadFolder(
		appDomain: string, version: string
	): Promise<{
		dir: WritableFS; rmDirOnErr: () => Promise<void>;
		mvDirOnCompletion: () => Promise<void>;
	}> {
		const packs = await this.getPackagesFS();
		const platform: Platform = 'web';
		const dlPath = `${PARTIAL_PACKS_DIR}/${appDomain}-${platform}-${version}-download`;
		return {
			dir: await packs.writableSubRoot(
				dlPath, { create: true, exclusive: true }),
			rmDirOnErr: () => packs.deleteFolder(dlPath, true),
			mvDirOnCompletion: () => packs.move(
				dlPath, completePackAppVersionFolder(appDomain, platform, version))
		};	
	}

}
Object.freeze(SystemPlaces.prototype);
Object.freeze(SystemPlaces);


export interface AppInitException extends web3n.RuntimeException {
	type: 'app-init',
	appDomain: string;
	version?: string;
	badAppPack?: true;
	notInstalled?: true;
	noBundledPack?: true;
	errAtInstall?: true;
}

export function makeAppInitExc(
	appDomain: string, flags: Partial<AppInitException>, cause?: any
): AppInitException {
	return makeRuntimeException<AppInitException>(
		'app-init', { appDomain, cause }, flags);
}

async function checkWebPackBeforeInstall(
	pack: ReadonlyFS, id: string, version: string
): Promise<void> {
	const { manifest, appRoot } = await appAndManifestFrom(pack)
	.catch(exc => {
		throw makeRuntimeException<AppInitException>('app-init',
			{ appDomain: id, version, cause: exc }, { badAppPack: true });
	});
	try {
		if (manifest.appDomain !== id) {
			throw makeRuntimeException<AppInitException>('app-init', {
				appDomain: id, version,
				message: `App domains don't match in manifest`
			}, { badAppPack: true });
		}
		if (manifest.version !== version) {
			throw makeRuntimeException<AppInitException>('app-init', {
				appDomain: id, version,
				message: `App versions don't match in manifest`
			}, { badAppPack: true });
		}
	} finally {
		await appRoot.close();
	}
}

async function findInstalledApp(
	appDomain: string, appsCode: ReadonlyFS, platform: Platform
): ReturnType<typeof appAndManifestFrom> {
	const current = await appsCode.readLink(
		`${appPlatformFolder(appDomain, platform)}/${CURRENT_FNAME}`
	).catch((exc: FileException) => {
		throw (exc.notFound ?
			makeAppInitExc(appDomain, { notInstalled: true }) : exc);
	});
	if (!current.isFolder) { throw makeAppInitExc(appDomain,
		{ message: `${CURRENT_FNAME} is not a link to folder` }); }
	const appFS = await current.target() as WritableFS;
	return appAndManifestFrom(appFS);
}

export async function appAndManifestFrom(
	appFS: ReadonlyFS
): Promise<{ appRoot: ReadonlyFS; manifest: AppManifest; }> {
	const manifest = await appFS.readJSONFile<AppManifest>(MANIFEST_FILE);
	const appRoot = await appFS.readonlySubRoot(APP_ROOT_FOLDER);
	return { appRoot, manifest };
}

async function unpackBundledApp(
	appDomain: string, packsFS: WritableFS, platform: Platform
): Promise<Observable<BundleUnpackProgress>> {
	const zipPath = join(BUNDLED_APPS_FOLDER, bundleWebZipName(appDomain));
	await checkPresenceOfBundledPackage(appDomain, zipPath);
	const unzipObs = new Subject<BundleUnpackProgress>();
	const forUnpack = await packsFS.writableSubRoot(PARTIAL_PACKS_DIR);
	unzipAppVersion(
		zipPath, forUnpack, p => unzipObs.next(p)
	).then(async ({ unpackedFolder, version }) => {
		await packsFS.move(
			`${PARTIAL_PACKS_DIR}/${unpackedFolder}`,
			completePackAppVersionFolder(appDomain, platform, version));
		unzipObs.complete();
	})
	.catch(exc => unzipObs.error(exc))
	.then(() => forUnpack.close());
	return unzipObs.asObservable();
}

async function checkPresenceOfBundledPackage(
	appDomain: string, zipPath: string
): Promise<void> {
	const zipStat = await stat(zipPath).catch((exc: FileException) => {
		throw (exc.notFound ?
			makeAppInitExc(appDomain, { noBundledPack: true }) : exc);
	});
	if (!zipStat.isFile()) {
		throw makeAppInitExc(appDomain, { noBundledPack: true });
	}
}

function bundleWebZipName(appDomain: string): string {
	return `${reverseDomain(appDomain)}.zip`;
}

function appPlatformFolder(appDomain: string, platform: Platform): string {
	return `${reverseDomain(appDomain)}/${platform}`;
}

function appVersionFolder(
	appDomain: string, platform: Platform, version: string
): string {
	return `${reverseDomain(appDomain)}/${platform}/${version}`;
}

function completePackAppVersionFolder(
	appDomain: string, platform: Platform, version: string
): string {
	return `${COMPLETE_PACKS_DIR}/${appVersionFolder(appDomain, platform,  version)}`;
}

function appDomainFromFolder(fName: string): string {
	return reverseDomain(fName);
}

async function listInstalledApps(codeFS: ReadonlyFS): Promise<AppInfo[]> {
	const lst = await codeFS.listFolder('/');
	const infos: AppInfo[] = [];
	for (const entry of lst) {
		const info = await getInstalledAppInfo(codeFS, entry.name)
		.catch(err => logError(
			err, `Error during listing app in ${entry.name} folder of installed`
		));
		if (info) {
			infos.push(info);
		}
	}
	return infos;
}

async function getInstalledAppInfo(
	codeFS: ReadonlyFS, appFolder: string
): Promise<AppInfo|undefined> {
	const lstOfAppFolder = await codeFS.listFolder(appFolder)
	.catch((exc: FileException) => {
		if (!exc.notFound) { throw exc; }
	});
	if (!lstOfAppFolder) { return; }
	const platforms = lstOfAppFolder
	.filter(entry => entry.isFolder)
	.map(entry => entry.name as Platform);
	if (platforms.length === 0) { return; }
	const installed: NonNullable<AppInfo['installed']> = [];
	let id: string|undefined = undefined;
	for (const platform of platforms) {
		const current = await codeFS.readLink(
			`${appFolder}/${platform}/${CURRENT_FNAME}`
		).catch((exc: FileException) => {
			if (exc.notFound) { return; }
			else { throw exc; }
		});
		if (!current) { continue; }
		const appFS = await current.target() as ReadonlyFS;
		const m = await appFS.readJSONFile<AppManifest>(MANIFEST_FILE);
		await appFS.close();
		id = m.appDomain;
		installed.push({ platform, version: m.version });
	}
	return (id ? { id, installed } : undefined);
}

async function listBundledApps(): Promise<AppInfo[]> {
	const bundleFiles = (await readdir(BUNDLED_APPS_FOLDER))
	.filter(fName => fName.endsWith(`.zip`))
	.map(fName => join(BUNDLED_APPS_FOLDER, fName));
	const infos: AppInfo[] = [];
	for (const file of bundleFiles) {
		const info = await getAppInfoFromZip(file);
		if (info) {
			infos.push(info);
		}
	}
	return infos;
}

async function getAppInfoFromZip(file: string): Promise<AppInfo|undefined> {
	const m = await readManifestFromZip(file);
	return (m ? {
		id: m.appDomain,
		bundled: [ {
			platform: 'web',
			version: m.version
		} ]
	} : undefined);
}

function getBundledAppInfo(id: string): Promise<AppInfo|undefined> {
	return getAppInfoFromZip(join(BUNDLED_APPS_FOLDER, bundleWebZipName(id)));
}

async function listCompletePacks(packsFS: ReadonlyFS): Promise<AppInfo[]> {
	const lst = await packsFS.listFolder(COMPLETE_PACKS_DIR)
	.catch((exc: FileException) => {
		if (exc.notFound) { return []; }
		else { throw exc; }
	});
	const infos: AppInfo[] = [];
	for (const entry of lst) {
		const info = await getAppPacksInfo(packsFS, entry.name);
		if (info) {
			infos.push(info);
		}
	}
	return infos;
}

async function getAppPacksInfo(
	packsFS: ReadonlyFS, appFolder: string
): Promise<AppInfo|undefined> {
	const packsFolder = `${COMPLETE_PACKS_DIR}/${appFolder}`;
	const lstOfAppFolder = await packsFS.listFolder(packsFolder)
	.catch(async (exc: FileException) => {
		if (!exc.notFound) { throw exc; }
	});
	if (!lstOfAppFolder) { return; }
	const platforms = lstOfAppFolder
	.filter(entry => entry.isFolder)
	.map(entry => entry.name as Platform);
	if (platforms.length === 0) { return; }
	const packs: NonNullable<AppInfo['packs']> = [];
	for (const platform of platforms) {
		const versions = (await packsFS.listFolder(`${packsFolder}/${platform}`))
		.filter(entry => entry.isFolder)
		.map(entry => entry.name)
		.map(version => ({ platform, version }));
		if (versions.length === 0) { continue; }
		packs.push(...versions);
	}
	return ((packs.length > 0) ? {
		id: appDomainFromFolder(appFolder),
		packs
	} : undefined);
}


Object.freeze(exports);