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
import { Envelope, ObjectsConnector, exposeStartupW3N, exposeW3N, ExposedObj, ExposedServices } from 'core-3nweb-client-lib';
import { ipcMain, WebContents } from 'electron';
import { IPC_CORE_SIDE, IPC_CLIENT_SIDE, IPC_SYNCED_W3N_LIST } from "./ipc-constants";
import { exposeDeviceCAP } from "../device/device-cap-ipc";
import { openChildWindow, openViewer, openWithOSApp, openWithOSBrowser, closeSelf } from "../app-init/open-close-caps-ipc";
import { exposeAppsOpenerCAP } from '../app-init/apps-opener-cap-ipc';
import { toBuffer } from "../lib-common/buffer-utils";
import { exposeLogoutCAP } from "../app-init/logout-cap-ipc";
import { exposeAppsDownloaderCAP } from "../app-downloader/apps-downloader-cap-ipc";
import { exposeAppsInstallerCAP } from "../app-installer/apps-installer-cap-ipc";
import { exposePlatformDownloaderCAP } from "../app-platform/platform-downloader-cap-ipc";

type StartupW3N = web3n.startup.W3N;
type W3N = web3n.ui.W3N;
type Apps = web3n.ui.Apps;


export class CoreSideConnectors {

	private readonly connectors = new Map<WebContents, Connector>();

	constructor() {
		this.listenMainIPC();
		Object.freeze(this);
	}

	private listenMainIPC(): void {
		ipcMain.on(IPC_CORE_SIDE, (event, msg: Envelope) => {
			const connector = this.connectors.get(event.sender);
			if (!connector) { return; }
			if (msg.body) {
				msg.body.value = toBuffer(msg.body.value);
			}
			connector.fromClient.next(msg);
		});
		ipcMain.on(IPC_SYNCED_W3N_LIST, (event, path: string[]) => {
			const connector = this.connectors.get(event.sender);
			if (!connector) { return; }
			event.returnValue = connector.coreSide.exposedServices.listObj(path);
		});
	}

	connectStartupW3N(coreW3N: StartupW3N, client: WebContents): void {
		const coreSide = this.makeCoreSideConnector(client);
		exposeStartupW3N(coreSide.exposedServices, coreW3N);
	}

	connectW3N(coreW3N: W3N, client: WebContents): void {
		const coreSide = this.makeCoreSideConnector(client);
		ipcMain.on(IPC_SYNCED_W3N_LIST, (event, path) => {
			event.returnValue = coreSide.exposedServices.listObj(path);
		});
		exposeW3N(coreSide.exposedServices, coreW3N, {
			closeSelf: closeSelf.expose,
			device: exposeDeviceCAP,
			openChildWindow: openChildWindow.expose,
			openViewer: openViewer.expose,
			openWithOSApp: openWithOSApp.expose,
			openWithOSBrowser: openWithOSBrowser.expose,
			apps: exposeAppsCAP,
			logout: exposeLogoutCAP
		});
	}

	private makeCoreSideConnector(client: WebContents): ObjectsConnector {
		const fromCore = new Subject<Envelope>();
		const fromClient = new Subject<Envelope>();
		const toCore = fromClient.asObservable();
		const removeConnector = () => this.connectors.delete(client);
		fromCore.asObservable().subscribe({
			next: msg => client.send(IPC_CLIENT_SIDE, msg),
			error: removeConnector,
			complete: removeConnector
		});
		const coreSide = new ObjectsConnector(fromCore, toCore, 'services');
		this.connectors.set(client, { coreSide, fromClient });
		client.on('destroyed', () => coreSide.close());
		return coreSide;
	}

}
Object.freeze(CoreSideConnectors.prototype);
Object.freeze(CoreSideConnectors);


interface Connector {
	coreSide: ObjectsConnector;
	fromClient: Subject<Envelope>;
}

function exposeAppsCAP(
	cap: Apps, expServices: ExposedServices
): ExposedObj<Apps> {
	const wrap: ExposedObj<Apps> = {};
	if (cap.opener) {
		wrap.opener = exposeAppsOpenerCAP(cap.opener, expServices);
	}
	if (cap.downloader) {
		wrap.downloader = exposeAppsDownloaderCAP(cap.downloader);
	}
	if (cap.installer) {
		wrap.installer = exposeAppsInstallerCAP(cap.installer);
	}
	if (cap.platform) {
		wrap.platform = exposePlatformDownloaderCAP(cap.platform);
	}
	return wrap;
}


Object.freeze(exports);