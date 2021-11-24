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

import { Core, CoreConf, FactoryOfFSs, cryptors } from "core-3nweb-client-lib";
import { makeNetClient } from "../electron/net";
import { AppManifest, BASE_APP_DOMAIN } from '../app-init/app-settings';
import { makeDeviceFileOpener } from "../device/device";
import { AppInstance } from "../app-init/app-instance";
import { shell } from "electron";
import { makeChildOpener } from "../app-init/child-app";
import { prepareUserDataMntPath, prepareDebugAppsDataMntPaths, MountsInOS } from "../mounts/mounts-in-os";
import { logError } from "../confs";
import { makeServiceLocator } from "core-3nweb-client-lib/build/lib-client/service-locator";
import { promises as dns } from 'dns';


export interface CoreDriver {
	close(): Promise<void>;
	makeCAPsForApp(
		appDomain: string, manifest: AppManifest, devTools: boolean
	): AppCAPsAndSetup;
	start(
		logCAP?: boolean
	): { capsForStartup: web3n.startup.W3N; coreInit: Promise<void>; };
	isStarted(): boolean;
	storages: FactoryOfFSs;
	getUserId(): string;
}

export interface AppCAPsAndSetup {
	w3n: W3N;
	close: () => void;
	setApp: AppSetter;
}

export type AppSetter = (app: AppInstance) => void;

export function makeCoreDriver(
	conf: CoreConf, viewerOpener: web3n.ui.OpenViewer,
	appsCapFns: web3n.ui.Apps, logout: web3n.ui.Logout
): CoreDriver {
	return new Driver(conf, viewerOpener, appsCapFns, logout);
}

// XXX simplify type expression, when definitions are done
type W3N = web3n.ui.W3N & web3n.caps.common.W3N;
type FS = web3n.files.FS;
type File = web3n.files.File;


class Driver implements CoreDriver {

	private readonly core: Core;
	private signedUser: string|undefined = undefined;
	private readonly fsMounts: MountsInOS;

	constructor(
		conf: CoreConf,
		private readonly viewerOpener: web3n.ui.OpenViewer,
		private readonly appsCapFns: web3n.ui.Apps,
		private readonly logout: web3n.ui.Logout
	) {
		this.core = Core.make(
			conf,
			makeNetClient,
			makeServiceLocator({
				resolveTxt: hostname => dns.resolveTxt(hostname)
			}),
			cryptors.makeInWorkerWasmCryptor);
		this.fsMounts = new MountsInOS(this.core.getStorages());
		Object.seal(this);
	}

	async close(): Promise<void> {
		await this.fsMounts.close().catch(logError);
		await this.core.close().catch(logError);
	}

	start(
		logCAP = false
	): { capsForStartup: web3n.startup.W3N; coreInit: Promise<void>; } {
		if (!this.core) { throw new Error(`Core is already closed`); }
		const { capsForStartup, coreInit } = this.core.start(logCAP);
		return {
			capsForStartup,
			coreInit: coreInit.then(userId => this.doAfterInit(userId))
		};
	}

	private async doAfterInit(userId: string): Promise<void> {
		this.signedUser = userId;
		// XXX mounting into OS should be moved from here to mount CAP(s)
		// await this.mountUserStorageInOS();
		// await this.mountAppsFoldersForDebug();
	}

	private async mountUserStorageInOS(): Promise<void> {
		if (!this.core) { throw new Error(`Core is already closed`); }
		const mntPath = await prepareUserDataMntPath();
		if (!mntPath) { return; }
		await this.fsMounts.mountStorageFolderInOS('user', 'synced', '', mntPath)
		.catch(err => logError(err,
			`Can't mount user's synced storage to ${mntPath}`));
	}

	private async mountAppsFoldersForDebug(): Promise<void> {
		if (!this.core) { throw new Error(`Core is already closed`); }
		const paths = await prepareDebugAppsDataMntPaths();
		if (!paths) { return; }
		await this.fsMounts.mountStorageFolderInOS(
			'system', 'synced', 'Apps Data', paths.syncedStore
		).catch(err => logError(
			err, `Can't mount system's synced storage to ${paths.syncedStore}`
		));
		await this.fsMounts.mountStorageFolderInOS(
			'system', 'local', 'Apps Data', paths.localStore
		).catch(err => logError(
			err, `Can't mount system's local storage to ${paths.localStore}`
		));
	}

	isStarted(): boolean {
		return !!this.signedUser;
	}

	getUserId(): string {
		if (this.signedUser) {
			return this.signedUser;
		} else {
			throw new Error(`Core is not initialized`);
		}
	}

	get storages() {
		if (!this.core) { throw new Error(`Core is already closed`); }
		return this.core.getStorages();
	}

	makeCAPsForApp(
		appDomain: string, manifest: AppManifest, devTools: boolean
	): { w3n: W3N; close: () => void; setApp: AppSetter; } {
		if (!this.core) { throw new Error(`Core is already closed`); }
		const baseW3N = this.core.makeCAPsForApp(appDomain, manifest);
		const closeSelf = this.closeSelfCAP(manifest);
		const device = this.deviceCAP(manifest);
		const openChildWindow = this.openChildWindowCAP(manifest);
		const close = () => {
			if (device) { device.close(); }
			if (openChildWindow) { openChildWindow.close(); }
			baseW3N.close();
		};
		const setApp: AppSetter = app => {
			closeSelf.setApp(app);
			if (device) { device.setApp(app); }
			if (openChildWindow) { openChildWindow.setApp(app); }
		};
		const w3n: W3N = {
			log: baseW3N.caps.log,
			storage: baseW3N.caps.storage,
			mail: baseW3N.caps.mail,
			mailerid: baseW3N.caps.mailerid,
			closeSelf: closeSelf.cap,
			device: (device ? device.cap : undefined),
			openChildWindow: (openChildWindow ? openChildWindow.cap : undefined),
			openViewer: this.openViewerCAP(manifest, devTools),
			openWithOSApp: this.openWithOSAppCAP(manifest),
			openWithOSBrowser: this.openWithOSBrowserCAP(manifest),
			apps: this.appsCAP(manifest),
			logout: this.logoutCAP(manifest)
			// parent
		};
		return { w3n, close, setApp };
	}

	private closeSelfCAP(
		m: AppManifest
	): { cap: W3N['closeSelf']; setApp: AppSetter; } {
		let self: AppInstance = undefined as any;
		const cap: W3N['closeSelf'] = () => {
			if (self) {
				self.window.close();
			}
		};
		const setApp = app => { self = app; };
		return { cap, setApp };
	};

	private deviceCAP(
		m: AppManifest
	): ReturnType<typeof makeDeviceFileOpener>|undefined {
		if (!m.capsRequested.device) { return; }
		const device = makeDeviceFileOpener();
		if (m.capsRequested.device.fileDialog === 'all') {
			return device;
		} else {
			return;	// explicit undefined
		}
	};

	private openWithOSAppCAP(m: AppManifest): W3N['openWithOSApp'] {
		if (m.capsRequested.openWithOSApp === 'all') {
			return this.openWithOS;
		}
		return undefined;
	};

	// XXX driver is a place to attach fs mounting in os

	private async openWithOS(f: FS|File): Promise<boolean> {
		// XXX
		// const mountPath = await this.core!.storages.mountInOS(f);
		// return shell.openItem(mountPath);
		throw new Error(`Not implemented, waiting for fs mount in OS`);
	}

	private openViewerCAP(m: AppManifest, devTools: boolean): W3N['openViewer'] {
		if (m.capsRequested.openViewer === 'all') {
			return this.viewerOpener;
		}
	}

	private openChildWindowCAP(m: AppManifest): {
		cap: W3N['openChildWindow']; setApp: AppSetter; close: () => void;
	}|undefined {
		if (m.capsRequested.openChildWindow === 'all') {
			return makeChildOpener();
		}
	}

	private openWithOSBrowserCAP(m: AppManifest): W3N['openWithOSBrowser'] {
		if (m.capsRequested.openWithOSBrowser === 'all') {
			return url => {
				if (!url.startsWith('https://')
				|| !url.startsWith('http://')) { return; }
				shell.openExternal(url);
			};
		}
	}

	private appsCAP(m: AppManifest): W3N['apps'] {
		// we are selective about what app can have this capability
		if (!m.appDomain.endsWith(`.${BASE_APP_DOMAIN}`)) { return; }
		if (m.capsRequested.apps === 'all') {
			return this.appsCapFns;
		} else if (m.capsRequested.apps) {
			const apps: W3N['apps'] = {};
			if (Array.isArray(m.capsRequested.apps)) {
				for (const key of m.capsRequested.apps) {
					apps[key] = this.appsCapFns[key] as any;
				}
			} else if ((typeof m.capsRequested.apps === 'string')
			&& this.appsCapFns[m.capsRequested.apps]) {
				const key = m.capsRequested.apps as any;
				apps[key] = this.appsCapFns[key] as any;
			}
			return ((Object.keys(apps).length > 0) ? apps : undefined);
		}
	}

	private logoutCAP(m: AppManifest): W3N['logout'] {
		// we are selective about what app can have this capability
		if (!m.appDomain.endsWith(`.${BASE_APP_DOMAIN}`)) { return; }
		if (m.capsRequested.logout === 'all') {
			return this.logout;
		}
	}

}
Object.freeze(Driver.prototype);
Object.freeze(Driver);


Object.freeze(exports);