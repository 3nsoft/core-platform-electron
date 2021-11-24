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

import { ExposedFn, Caller, ExposedObj, FileMsg, exposeFileService, ExposedServices, makeFileCaller } from 'core-3nweb-client-lib';
import { ProtoType, strValType } from '../ipc-via-protobuf/protobuf-msg';

type AppsOpener = web3n.ui.AppsOpener;

export function exposeAppsOpenerCAP(
	cap: AppsOpener, expServices: ExposedServices
): ExposedObj<AppsOpener> {
	return {
		listApps: listApps.wrapService(cap.listApps),
		openApp: openApp.wrapService(cap.openApp),
		getAppIcon: getAppIcon.wrapService(cap.getAppIcon, expServices),
		getAppInfo: getAppInfo.wrapService(cap.getAppInfo),
	};
}

export function makeAppsOpenerCaller(
	caller: Caller, objPath: string[]
): AppsOpener {
	return {
		listApps: listApps.makeCaller(caller, objPath),
		openApp: openApp.makeCaller(caller, objPath),
		getAppIcon: getAppIcon.makeCaller(caller, objPath),
		getAppInfo: getAppInfo.makeCaller(caller, objPath),
	};
}


function appsOpenerType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('appsopener.proto', `appsopener.${type}`);
}


namespace listApps {

	export function wrapService(fn: AppsOpener['listApps']): ExposedFn {
		return () => {
			const promise = fn()
			.then(apps => strValType.pack({ value: JSON.stringify(apps) }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): AppsOpener['listApps'] {
		const path = objPath.concat('listApps');
		return async () => {
			const buf = await caller.startPromiseCall(path, undefined);
			return JSON.parse(strValType.unpack(buf).value);
		};
	}

}
Object.freeze(listApps);


namespace openApp {

	const requestType = appsOpenerType<{
		id: string; devtools?: boolean;
	}>('OpenAppRequestBody');
	
	export function wrapService(fn: AppsOpener['openApp']): ExposedFn {
		return buf => {
			const { id, devtools } = requestType.unpack(buf);
			const promise = fn(id);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): AppsOpener['openApp'] {
		const path = objPath.concat('openApp');
		return async (id, devtools) => {
			const req = requestType.pack({ id, devtools });
			await caller.startPromiseCall(path, req);
		};
	}

}
Object.freeze(openApp);


const requestWithAppIdType = appsOpenerType<{
	id: string;
}>('RequestWithAppId');


namespace getAppInfo {

	export function wrapService(fn: AppsOpener['getAppInfo']): ExposedFn {
		return buf => {
			const { id } = requestWithAppIdType.unpack(buf);
			const promise = fn(id)
			.then(info => strValType.pack({ value: JSON.stringify(info) }));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): AppsOpener['getAppInfo'] {
		const path = objPath.concat('getAppInfo');
		return async id => {
			const req = requestWithAppIdType.pack({ id });
			const buf = await caller.startPromiseCall(path, req);
			const { value: infoInJson } = strValType.unpack(buf);
			return (infoInJson ? JSON.parse(infoInJson) : undefined);
		};
	}

}
Object.freeze(getAppInfo);


namespace getAppIcon {

	const replyType = appsOpenerType<{
		file: FileMsg;
	}>('GetAppIconReplyBody');

	export function wrapService(
		fn: AppsOpener['getAppIcon'], expServices: ExposedServices
	): ExposedFn {
		return buf => {
			const { id } = requestWithAppIdType.unpack(buf);
			const promise = fn(id)
			.then(file => replyType.pack({
				file: exposeFileService(file, expServices)
			}));
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): AppsOpener['getAppIcon'] {
		const path = objPath.concat('getAppIcon');
		return async id => {
			const req = requestWithAppIdType.pack({ id });
			const buf = await caller.startPromiseCall(path, req);
			const reply = replyType.unpack(buf);
			return makeFileCaller(caller, reply.file) as web3n.files.ReadonlyFile;
		};
	}

}
Object.freeze(getAppIcon);


Object.freeze(exports);