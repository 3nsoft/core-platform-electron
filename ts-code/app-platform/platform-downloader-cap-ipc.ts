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

import { ExposedFn, Caller, ExposedObj, EnvelopeBody } from 'core-3nweb-client-lib';
import { Subject, Observer as RxObserver } from 'rxjs';
import { map } from 'rxjs/operators';
import { ProtoType, strValType } from '../ipc-via-protobuf/protobuf-msg';

type Platform = web3n.ui.Platform;
type PlatformDownloadProgress = web3n.ui.PlatformDownloadProgress;

export function exposePlatformDownloaderCAP(
	cap: Platform
): ExposedObj<Platform> {
	return {
		getCurrentVersion: getCurrentVersion.wrapService(cap.getCurrentVersion),
		getChannels: getChannels.wrapService(cap.getChannels),
		getLatestVersion: getLatestVersion.wrapService(cap.getLatestVersion),
		getVersionList: getVersionList.wrapService(cap.getVersionList),
		availableUpdateType: availableUpdateType.wrapService(
			cap.availableUpdateType),
		downloadAndApplyUpdate: downloadAndApplyUpdate.wrapService(
			cap.downloadAndApplyUpdate)
	};
}

export function makePlatformDownloaderCaller(
	caller: Caller, objPath: string[]
): Platform {
	return {
		getCurrentVersion: getCurrentVersion.makeCaller(caller, objPath),
		getChannels: getChannels.makeCaller(caller, objPath),
		getLatestVersion: getLatestVersion.makeCaller(caller, objPath),
		getVersionList: getVersionList.makeCaller(caller, objPath),
		availableUpdateType: availableUpdateType.makeCaller(caller, objPath),
		downloadAndApplyUpdate: downloadAndApplyUpdate.makeCaller(caller, objPath)
	};
}

function appsplatformType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('appsplatform.proto', `appsplatform.${type}`);
}


namespace getCurrentVersion {

	export function wrapService(fn: Platform['getCurrentVersion']): ExposedFn {
		return () => {
			const promise = fn()
			.then(version => strValType.pack({ value: version }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Platform['getCurrentVersion'] {
		const path = objPath.concat('getCurrentVersion');
		return async () => {
			const buf = await caller.startPromiseCall(path, undefined);
			return strValType.unpack(buf).value;
		};
	}

}
Object.freeze(getCurrentVersion);


namespace getChannels {

	export function wrapService(fn: Platform['getChannels']): ExposedFn {
		return () => {
			const promise = fn()
			.then(channels => strValType.pack({
				value: JSON.stringify(channels)
			}));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Platform['getChannels'] {
		const path = objPath.concat('getChannels');
		return async () => {
			const buf = await caller.startPromiseCall(path, undefined);
			return JSON.parse(strValType.unpack(buf).value);
		};
	}

}
Object.freeze(getChannels);


const requestWithChannelType = appsplatformType<{
	channel: string;
}>('RequestWithChannel');


namespace getLatestVersion {

	export function wrapService(fn: Platform['getLatestVersion']): ExposedFn {
		return buf => {
			const { channel } = requestWithChannelType.unpack(buf);
			const promise = fn(channel)
			.then(latest => strValType.pack({ value: latest }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Platform['getLatestVersion'] {
		const path = objPath.concat('getLatestVersion');
		return async channel => {
			const req = requestWithChannelType.pack({ channel });
			const buf = await caller.startPromiseCall(path, req);
			return strValType.unpack(buf).value;
		};
	}

}
Object.freeze(getLatestVersion);


namespace getVersionList {

	const requestType = appsplatformType<{
		version: string;
	}>('GetVersionListRequestBody');

	export function wrapService(fn: Platform['getVersionList']): ExposedFn {
		return buf => {
			const { version } = requestType.unpack(buf);
			const promise = fn(version)
			.then(packs => strValType.pack({ value: JSON.stringify(packs) }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Platform['getVersionList'] {
		const path = objPath.concat('getVersionList');
		return async version => {
			const req = requestType.pack({ version });
			const buf = await caller.startPromiseCall(path, req);
			return JSON.parse(strValType.unpack(buf).value);
		};
	}

}
Object.freeze(getVersionList);


namespace availableUpdateType {

	export function wrapService(fn: Platform['availableUpdateType']): ExposedFn {
		return () => {
			const promise = fn()
			.then(updaterType => strValType.pack({
				value: (updaterType ? updaterType : '')
			}));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Platform['availableUpdateType'] {
		const path = objPath.concat('availableUpdateType');
		return async () => {
			const buf = await caller.startPromiseCall(path, undefined);
			const str = strValType.unpack(buf).value;
			return ((str === '') ? undefined : str);
		};
	}

}
Object.freeze(availableUpdateType);


namespace downloadAndApplyUpdate {

	export function wrapService(
		fn: Platform['downloadAndApplyUpdate']
	): ExposedFn {
		return buf => {
			const { channel } = requestWithChannelType.unpack(buf);
			const s = new Subject<PlatformDownloadProgress>();
			const obs = s.asObservable().pipe(
				map(p => strValType.pack({ value: JSON.stringify(p) }))
			);
			const onCancel = fn(channel, s);
			return { obs, onCancel };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Platform['downloadAndApplyUpdate'] {
		const path = objPath.concat('downloadAndApplyUpdate');
		return (channel, obs) => {
			const s = new Subject<EnvelopeBody>();
			const unsub = caller.startObservableCall(
				path, requestWithChannelType.pack({ channel }), s);
			s.pipe(
				map(buf => JSON.parse(strValType.unpack(buf).value))
			)
			.subscribe(obs as RxObserver<PlatformDownloadProgress>);
			return unsub;
		};
	}

}
Object.freeze(downloadAndApplyUpdate);


Object.freeze(exports);