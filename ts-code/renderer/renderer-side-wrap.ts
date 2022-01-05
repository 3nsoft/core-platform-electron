/*
 Copyright (C) 2020 - 2021 3NSoft Inc.
 
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

import { Subject } from "rxjs";
import { Envelope, ObjectsConnector, makeStartupW3Nclient, makeW3Nclient, Caller } from 'core-3nweb-client-lib';
import { ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC_CORE_SIDE, IPC_CLIENT_SIDE, IPC_SYNCED_W3N_LIST } from "../core/ipc-constants";
import { makeDeviceCaller } from "../device/device-cap-ipc";
import { openChildWindow, openViewer, openWithOSApp, openWithOSBrowser, closeSelf } from "../app-init/open-close-caps-ipc";
import { makeAppsOpenerCaller } from '../app-init/apps-opener-cap-ipc';
import { toBuffer } from "../lib-common/buffer-utils";
import { makeLogoutCaller } from "../app-init/logout-cap-ipc";
import { makeAppsDownloaderCaller } from "../app-downloader/apps-downloader-cap-ipc";
import { makeAppsInstallerCaller } from "../app-installer/apps-installer-cap-ipc";
import { makePlatformDownloaderCaller } from "../app-platform/platform-downloader-cap-ipc";
import { makeStartupTestStandCaller, makeTestStandCaller } from "../test-stand/test-stand-cap-ipc";

type StartupW3N = web3n.startup.W3N;
type W3N = web3n.ui.W3N;
type Apps = web3n.ui.Apps;

function makeClientSideConnector(): ObjectsConnector {
	const fromCore = new Subject<Envelope>();
	const coreListener = (event: IpcRendererEvent, msg: Envelope) => {
		if (event.senderId === 0) {
			if (msg.body) {
				msg.body.value = toBuffer(msg.body.value);
			}
			fromCore.next(msg);
		}
	};
	const listObjOnServiceSide = (
		path: string[]
	) => ipcRenderer.sendSync(IPC_SYNCED_W3N_LIST, path);
	ipcRenderer.on(IPC_CLIENT_SIDE, coreListener);
	const detachListener = () => ipcRenderer.removeListener(
		IPC_CLIENT_SIDE, coreListener);
	const toClient = fromCore.asObservable();
	const fromClient = new Subject<Envelope>();
	fromClient.asObservable().subscribe({
		next: msg => ipcRenderer.send(IPC_CORE_SIDE, msg),
		error: detachListener,
		complete: detachListener
	});
	return new ObjectsConnector(
		fromClient, toClient, 'clients', listObjOnServiceSide);
}

export function makeStartupW3N(): StartupW3N {
	const clientSide = makeClientSideConnector();
	const clientW3N = makeStartupW3Nclient<web3n.testing.StartupW3N>(
		clientSide.caller, {
			testStand: makeStartupTestStandCaller
		});
	return clientW3N;
}

export function makeW3N(): W3N {
	const clientSide = makeClientSideConnector();
	const clientW3N = makeW3Nclient<web3n.testing.CommonW3N>(
		clientSide.caller, {
			closeSelf: closeSelf.makeClient,
			device: makeDeviceCaller,
			openChildWindow: openChildWindow.makeClient,
			openViewer: openViewer.makeClient,
			openWithOSApp: openWithOSApp.makeClient,
			openWithOSBrowser: openWithOSBrowser.makeClient,
			apps: makeAppsCaller,
			logout: makeLogoutCaller,
			testStand: makeTestStandCaller,
		});
	return clientW3N;
}

function makeAppsCaller(caller: Caller, objPath: string[]): Apps {
	const lstAppsCAP = caller.listObj(objPath) as (keyof Apps)[];
	const opener = lstAppsCAP.includes('opener');
	const downloader = lstAppsCAP.includes('downloader');
	const installer = lstAppsCAP.includes('installer');
	const platform = lstAppsCAP.includes('platform');
	const apps: Apps = {};
	if (opener) {
		apps.opener = makeAppsOpenerCaller(caller, objPath.concat('opener'));
	}
	if (downloader) {
		apps.downloader = makeAppsDownloaderCaller(
			caller, objPath.concat('downloader'));
	}
	if (installer) {
		apps.installer = makeAppsInstallerCaller(
			caller, objPath.concat('installer'));
	}
	if (platform) {
		apps.platform = makePlatformDownloaderCaller(
			caller, objPath.concat('platform'));
	}
	return apps;
}


Object.freeze(exports);