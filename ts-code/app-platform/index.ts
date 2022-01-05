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

import { doBodylessRequest } from "../electron/request-utils";
import { makeRuntimeException } from "../lib-common/exceptions/runtime";
import { assert } from "../lib-common/assert";
import { makeUpdater } from "./updater";
import { findPackInfo } from "../confs";

type AppVersionPacks = web3n.ui.AppVersionPacks;
type PlatformDownloadProgress = web3n.ui.PlatformDownloadProgress;
type Observer<T> = web3n.Observer<T>;
type PlatformType = web3n.ui.PlatformType;
type DistChannels = web3n.ui.DistChannels;

const PLATFORM_BUNDLE_URL = 'https://3nweb.com/downloads/platform-bundle';
const PLATFORM_URL = 'https://3nweb.com/downloads/platform';


export class PlatformDownloader {

	private readonly packInfo = findPackInfo();
	private readonly type: 'electron-builder-update' | undefined;

	constructor() {
		this.type = this.packInfoToType();
		Object.seal(this);
	}

	private packInfoToType(): PlatformDownloader['type'] {
		if (!this.packInfo) {
			return;
		} else if (this.packInfo.platform === 'linux') {
			if (this.packInfo.variant === 'AppImage') {
				return 'electron-builder-update';
			} else {
				return;
			}
		} else if (this.packInfo.platform === 'mac') {
			if (this.packInfo.variant === 'dmg') {
				return 'electron-builder-update';
			} else {
				return;
			}
		} else if (this.packInfo.platform === 'windows') {
			if (this.packInfo.variant === 'nsis') {
				return 'electron-builder-update';
			} else {
				return;
			}
		}
	}

	getChannels(): Promise<DistChannels> {
		return platfChannels();
	}

	getLatestVersion(channel: string): Promise<string> {
		return channelLatestVersion(channel);
	}

	getVersionList(version: string): Promise<AppVersionPacks> {
		return listVersionPacks(version);
	}

	async availableUpdateType(): Promise<string|undefined> {
		return this.type;
	}

	downloadAndApplyUpdate(
		channel: string, observer: Observer<PlatformDownloadProgress>
	): () => void {
		if (this.type === 'electron-builder-update') {
			return runElectronBuilderUpdate(channel, observer);
		} else {
			throw makeDownloadExc({ noUpdateMechanism: true }, this.packInfo);
		}
	}

}
Object.freeze(PlatformDownloader.prototype);
Object.freeze(PlatformDownloader);


function platformUrl(platform?: PlatformType, bundle = true): string {
	if (!platform) {
		if (process.platform === 'linux') {
			platform = 'linux';
		} else if (process.platform === 'win32') {
			platform = 'windows';
		} else if (process.platform === 'darwin') {
			platform = 'mac';
		} else {
			throw new Error(`At this moment no update url is set for platform ${process.platform}`);
		}
	}
	return `${bundle ? PLATFORM_BUNDLE_URL : PLATFORM_URL}/${platform}`;
}

async function getJson<T>(url: string): Promise<T|undefined> {
	const rep = await doBodylessRequest<T>({
		method: 'GET', url, responseType: 'json'
	});
	return ((rep.status === 200) ? rep.data : undefined);
}

async function platfChannels(): Promise<DistChannels> {
	const channels = await getJson<DistChannels>(`${platformUrl()}/channels`);
	if (channels && (typeof channels.channels === 'object')) {
		return channels;
	} else {
		throw makeDownloadExc({ noChannels: true });
	}
}

function isNonEmptyStringArr(arr: string[]): boolean {
	return (Array.isArray(arr) && (arr.length > 0)
	&& !arr.find(s => ((typeof s !== 'string') || !s)));
}

async function listChannelVersions(channel: string): Promise<string[]> {
	assert((typeof channel === 'string') && (channel.length > 0),
		`Invalid channel: ${channel}`);
	const versions = await getJson<string[]>(`${platformUrl()}/${channel}.list`);
	if (versions && isNonEmptyStringArr(versions)) {
		return versions;
	} else {
		throw makeDownloadExc({ noVersions: true });
	}
}

async function channelLatestVersion(channel: string): Promise<string> {
	assert((typeof channel === 'string') && (channel.length > 0),
		`Invalid channel: ${channel}`);
	const latest = await getJson<string>(`${platformUrl()}/${channel}.latest`);
	if (latest && (typeof latest === 'string')) {
		return latest;
	} else {
		throw makeDownloadExc({ noVersions: true });
	}
}

async function listVersionPacks(version: string): Promise<AppVersionPacks> {
	assert((typeof version === 'string') && (version.length > 0),
		`Invalid version: ${version}`);
	const lst = await getJson<AppVersionPacks>(
		`${platformUrl()}/${version}/list`);
	if (lst && (typeof lst === 'object')) {
		return lst;
	} else {
		throw makeDownloadExc({ noVersionVariants: true });
	}
}

export interface PlatformDownloadException extends web3n.RuntimeException {
	type: 'platform-download',
	noChannels?: true;
	noVersions?: true;
	noVersionVariants?: true;
	noUnpackedVariant?: true;
	noAppContent?: true;
	badAppFile?: true;
	noUpdateMechanism?: true;
}

function makeDownloadExc(
	flags: Partial<PlatformDownloadException>, cause?: any
): PlatformDownloadException {
	return makeRuntimeException<PlatformDownloadException>(
		'platform-download', { cause }, flags);
}

function runElectronBuilderUpdate(
	channel: string, observer: Observer<PlatformDownloadProgress>
): () => void {
	let unsub: (() => void)|undefined = undefined;
	makeUpdater(channel).then(async updater => {
		if (updater) {
			unsub = updater.checkForUpdateAndApply(observer);
		} else if (observer && observer.error) {
			observer.error(new Error(`Failed to create an updater. Packing info is ${JSON.stringify(findPackInfo())}`));
		}
	});
	return () => {
		if (unsub) {
			unsub();
		} else {
			observer = undefined as any;
		}
	}; 
}

function noop() {}


Object.freeze(exports);