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

import { SystemPlaces } from "../app-installer/system-places";
import { doBodylessRequest } from "../electron/request-utils";
import { getAppLocation } from "./app-package-locator";
import { createHash } from "crypto";
import { from, Observable, Observer as RxObserver, Subject } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { MANIFEST_FILE } from "../app-installer/unpack-zipped-app";
import { AppManifest } from "../app-init/app-settings";
import { appChannels, appPlatformUrl, channelLatestVersion, listAppVersionPacks, getJson, makeAppDownloadExc } from "./download-resources";

type DownloadProgress = web3n.ui.DownloadProgress;
type Observer<T> = web3n.Observer<T>;
type AppVersionPacks = web3n.ui.AppVersionPacks;
type DistChannels = web3n.ui.DistChannels;


export class AppDownloader {

	constructor(
		private readonly sysPlaces: SystemPlaces
	) {
		Object.seal(this);
	}

	private async getAppUrl(id: string): Promise<string> {
		const appBaseUrl = await getAppLocation(id).catch(exc => {
			throw makeAppDownloadExc(id, { dnsErr: true }, exc);
		});
		return appPlatformUrl(appBaseUrl, 'web');
	}

	async getAppChannels(id: string): Promise<DistChannels> {
		const appUrl = await this.getAppUrl(id);
		return appChannels(appUrl, id);
	}

	async getLatestAppVersion(id: string, channel: string): Promise<string> {
		const appUrl = await this.getAppUrl(id);
		return channelLatestVersion(appUrl, id, channel);
	}

	async getAppVersionList(
		id: string, version: string
	): Promise<AppVersionPacks> {
		const appUrl = await this.getAppUrl(id);
		const { listInAppVersion } = await listAppVersionPacks(
			appUrl, id, version);
		return listInAppVersion;
	}

	downloadWebApp(
		id: string, version: string, observer: Observer<DownloadProgress>
	): () => void {
		const sub = from(this.startDownloadProc(id, version))
		.pipe(mergeMap(proc => proc))
		.subscribe(observer as RxObserver<DownloadProgress>);
		return () => sub.unsubscribe();
	}

	private async locateUnpackedApp(
		id: string, version: string
	): Promise<{ content: AppContent; unpackedAppUrl: string; }> {
		const appUrl = await this.getAppUrl(id);
		const {
			appVersionUrl, listInAppVersion
		} = await listAppVersionPacks(appUrl, id, version);
		const fName = getUnpackedFolder(listInAppVersion);
		if (!fName) { throw makeAppDownloadExc(id, { noUnpackedVariant: true }); }
		const unpackedAppUrl = `${appVersionUrl}/${fName}`;
		const content = await appVersionContent(id, unpackedAppUrl);
		return { content, unpackedAppUrl };
	}

	private async startDownloadProc(
		id: string, version: string
	): Promise<Observable<DownloadProgress>> {
		const procObs = new Subject<DownloadProgress>();
		this.locateUnpackedApp(id, version)
		.then(async ({ content, unpackedAppUrl }) => {
			const {
				dir, mvDirOnCompletion, rmDirOnErr
			} = await this.sysPlaces.makeDownloadFolder(id, version);
			let filesLeft = 0;
			let bytesLeft = 0;
			for (const file of content.content) {
				filesLeft += 1;
				bytesLeft += file.size;
			}
			const totalFiles = filesLeft;
			const totalBytes = bytesLeft;
			await dir.writeJSONFile(CONTENT_FNAME, content);
			try {
				procObs.next({ totalFiles, filesLeft, totalBytes, bytesLeft });
				for (const entry of content.content) {
					procObs.next({
						totalFiles, filesLeft, totalBytes, bytesLeft,
						currentFileSize: entry.size,
						fileInProgress: entry.file
					});
					const fileBytes = await downloadAndCheck(id, unpackedAppUrl, entry);
					await dir.writeBytes(entry.file, fileBytes);
					filesLeft -= 1;
					bytesLeft -= entry.size;
					procObs.next({ totalFiles, filesLeft, totalBytes, bytesLeft });
				}
				const m = await dir.readJSONFile<AppManifest>(MANIFEST_FILE);
				if (m.appDomain !== id) { throw makeAppDownloadExc(
					id, { badAppFile: true }, `Wrong app domain in manifest`
				); }
				await mvDirOnCompletion();
				procObs.complete();
			} catch (exc) {
				await rmDirOnErr();
			}
		}, exc => procObs.error(exc));
		return procObs.asObservable();
	}

}
Object.freeze(AppDownloader.prototype);
Object.freeze(AppDownloader);


function getUnpackedFolder(lst: AppVersionPacks): string|undefined {
	for (const [fName, info] of Object.entries(lst.files)) {
		if ((info.arch === 'web') && (info.variant === 'unpacked')) {
			return fName;
		}
	}
}

export interface AppContent {
	content: ContentFileInfo[];
}

export interface ContentFileInfo {
	file: string;
	sha512: string;
	size: number;
}

const CONTENT_FNAME = 'content.json';

async function appVersionContent(
	appDomain: string, unpackedAppUrl: string
): Promise<AppContent> {
	const content = await getJson<AppContent>(
		`${unpackedAppUrl}/${CONTENT_FNAME}`);
	if (content && Array.isArray(content.content)) {
		return content;
	} else {
		throw makeAppDownloadExc(appDomain, { noAppContent: true });
	}
}

async function downloadAppFile(
	appDomain: string, unpackedAppUrl: string, file: string
): Promise<Buffer> {
	const rep = await doBodylessRequest<Buffer>({
		method: 'GET',
		url: `${unpackedAppUrl}/${file}`,
		responseType: 'arraybuffer'
	});
	if (rep.status === 200) {
		return rep.data;
	} else {
		throw makeAppDownloadExc(appDomain, { badAppFile: true },
			`Can't download file ${file}. Server returns status ${rep.status}.`);
	}
}

function sha512(bytes: Buffer): string {
	const h = createHash('sha512');
	h.update(bytes);
	return h.digest('base64');
}

async function downloadAndCheck(
	appDomain: string, unpackedAppUrl: string, info: ContentFileInfo
): Promise<Uint8Array> {
	if (!info.sha512) { throw makeAppDownloadExc(
		appDomain, { badAppFile: true },
		`No expected sha512 for file ${info.file}`
	); }
	const fileContent = await downloadAppFile(
		appDomain, unpackedAppUrl, info.file);
	if (fileContent.length !== info.size) { throw makeAppDownloadExc(
		appDomain, { badAppFile: true },
		`Got ${fileContent.length} bytes for file ${info.file} instead of expected ${info.size}`
	); }
	if (info.sha512 !== sha512(fileContent)) { throw makeAppDownloadExc(
		appDomain, { badAppFile: true },
		`Calculated sha512 of file ${info.file} deviates from expected hash`
	); }
	return fileContent;
}


Object.freeze(exports);