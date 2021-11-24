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
import { ProtoType } from '../ipc-via-protobuf/protobuf-msg';

type AppsInstaller = web3n.ui.AppsInstaller;
type BundleUnpackProgress = web3n.ui.BundleUnpackProgress;

export function exposeAppsInstallerCAP(
	cap: AppsInstaller
): ExposedObj<AppsInstaller> {
	return {
		unpackBundledWebApp: unpackBundledWebApp.wrapService(
			cap.unpackBundledWebApp),
		installWebApp: installWebApp.wrapService(cap.installWebApp)
	};
}

export function makeAppsInstallerCaller(
	caller: Caller, objPath: string[]
): AppsInstaller {
	return {
		unpackBundledWebApp: unpackBundledWebApp.makeCaller(caller, objPath),
		installWebApp: installWebApp.makeCaller(caller, objPath)
	};
}

function appsInstallerType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('appsinstaller.proto', `appsinstaller.${type}`);
}

const requestWithAppIdType = appsInstallerType<{
	id: string;
}>('RequestWithAppId');


namespace unpackBundledWebApp {

	const progressEventType = appsInstallerType<BundleUnpackProgress>(
		'BundleUnpackProgress');

	export function wrapService(fn: AppsInstaller['unpackBundledWebApp']): ExposedFn {
		return buf => {
			const { id } = requestWithAppIdType.unpack(buf);
			const s = new Subject<BundleUnpackProgress>();
			const obs = s.asObservable().pipe(
				map(p => progressEventType.pack(p))
			);
			const onCancel = fn(id, s);
			return { obs, onCancel };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): AppsInstaller['unpackBundledWebApp'] {
		const path = objPath.concat('unpackBundledWebApp');
		return (id, obs) => {
			const s = new Subject<EnvelopeBody>();
			const unsub = caller.startObservableCall(
				path, requestWithAppIdType.pack({ id }), s);
			s.pipe(
				map(buf => progressEventType.unpack(buf))
			)
			.subscribe(obs as RxObserver<BundleUnpackProgress>);
			return unsub;
		};
	}

}
Object.freeze(unpackBundledWebApp);


const requestWithAppIdAndVersionType = appsInstallerType<{
	id: string; version: string;
}>('RequestWithAppIdAndVersion');


namespace installWebApp {

	export function wrapService(fn: AppsInstaller['installWebApp']): ExposedFn {
		return buf => {
			const { id, version } = requestWithAppIdAndVersionType.unpack(buf);
			const promise = fn(id, version);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): AppsInstaller['installWebApp'] {
		const path = objPath.concat('installWebApp');
		return async (id, version) => {
			const req = requestWithAppIdAndVersionType.pack({ id, version });
			await caller.startPromiseCall(path, req);
		};
	}

}
Object.freeze(installWebApp);


Object.freeze(exports);