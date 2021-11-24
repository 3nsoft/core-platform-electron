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

type AppVersionPacks = web3n.ui.AppVersionPacks;
type PlatformType = web3n.ui.PlatformType;
type DistChannels = web3n.ui.DistChannels;

export function appPlatformUrl(
	appBaseUrl: string, platform: PlatformType
): string {
	if (!appBaseUrl.endsWith('/')) {
		appBaseUrl += '/';
	}
	return `${appBaseUrl}${platform}`;
}

export async function getJson<T>(url: string): Promise<T|undefined> {
	const rep = await doBodylessRequest<T>({
		method: 'GET', url, responseType: 'json'
	});
	return ((rep.status === 200) ? rep.data : undefined);
}

export async function appChannels(
	appPlatfUrl: string, appDomain: string
): Promise<DistChannels> {
	const channels = await getJson<DistChannels>(`${appPlatfUrl}/channels`);
	if (channels && (typeof channels.channels === 'object')) {
		return channels;
	} else {
		throw makeAppDownloadExc(appDomain, { noChannels: true });
	}
}

function isNonEmptyStringArr(arr: string[]): boolean {
	return (Array.isArray(arr) && (arr.length > 0)
	&& !arr.find(s => ((typeof s !== 'string') || !s)));
}

export async function listChannelVersions(
	appPlatfUrl: string, appDomain: string, channel: string
): Promise<string[]> {
	assert((typeof channel === 'string') && (channel.length > 0),
		`Invalid channel: ${channel}`);
	const versions = await getJson<string[]>(`${appPlatfUrl}/${channel}.list`);
	if (versions && isNonEmptyStringArr(versions)) {
		return versions;
	} else {
		throw makeAppDownloadExc(appDomain, { noVersions: true });
	}
}

export async function channelLatestVersion(
	appPlatfUrl: string, appDomain: string, channel: string
): Promise<string> {
	assert((typeof channel === 'string') && (channel.length > 0),
		`Invalid channel: ${channel}`);
	const latest = await getJson<string>(`${appPlatfUrl}/${channel}.latest`);
	if (latest && (typeof latest === 'string')) {
		return latest;
	} else {
		throw makeAppDownloadExc(appDomain, { noVersions: true });
	}
}

export async function listAppVersionPacks(
	appPlatfUrl: string, appDomain: string, version: string
): Promise<{ listInAppVersion: AppVersionPacks; appVersionUrl: string; }> {
	assert((typeof version === 'string') && (version.length > 0),
		`Invalid version: ${version}`);
	const appVersionUrl = `${appPlatfUrl}/${version}`;
	const lst = await getJson<AppVersionPacks>(`${appVersionUrl}/list`);
	if (lst && (typeof lst === 'object')) {
		return { appVersionUrl, listInAppVersion: lst };
	} else {
		throw makeAppDownloadExc(appDomain, { noVersionVariants: true });
	}
}

export interface AppDownloadException extends web3n.RuntimeException {
	type: 'app-download',
	appDomain: string;
	dnsErr?: true;
	noChannels?: true;
	noVersions?: true;
	noVersionVariants?: true;
	noUnpackedVariant?: true;
	noAppContent?: true;
	badAppFile?: true;
}

export function makeAppDownloadExc(
	appDomain: string, flags: Partial<AppDownloadException>, cause?: any
): AppDownloadException {
	return makeRuntimeException<AppDownloadException>(
		'app-download', { appDomain, cause }, flags);
}


Object.freeze(exports);