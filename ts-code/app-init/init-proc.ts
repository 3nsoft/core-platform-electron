/*
 Copyright (C) 2016 - 2021 3NSoft Inc.
 
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

import { AppInstance, FS, DevAppInstanceFromUrl } from './app-instance';
import { ViewerInstance } from './viewer-instance';
import { STARTUP_APP_DOMAIN, APPS_MENU_DOMAIN } from './app-settings';
import { NamedProcs } from '../lib-common/processes';
import { join } from 'path';
import { DeviceFS, CoreConf } from 'core-3nweb-client-lib';
import { errWithCause } from '../lib-common/exceptions/error';
import { CoreDriver, makeCoreDriver } from '../core/core-driver';
import { reverseDomain } from 'core-3nweb-client-lib';
import { CoreSideConnectors } from '../core/core-side-wrap';
import { app, WebContents } from 'electron';
import { logError } from '../confs';
import { setTimeout } from 'timers';
import { getDevToolFlag, DevAppParams } from '../process-args';
import { appAndManifestFrom, BUNDLED_APPS_FOLDER, SystemPlaces, AppInitException, makeAppInitExc } from '../app-installer/system-places';
import { AppDownloader } from '../app-downloader/app-downloader';
import { latestVersionIn } from '../app-downloader/versions';
import { PlatformDownloader } from '../app-platform/platform-downloader';
import { createTray } from './desktop-tray';
import { Observable, Subject } from 'rxjs';


export class InitProc {

	private readonly apps = new Map<string, AppInstance>();
	private readonly viewers = new Set<ViewerInstance>();
	private readonly appStartingProcs = new NamedProcs();
	private readonly connectors: CoreSideConnectors = new CoreSideConnectors();
	private readonly callbacksOnExit = new Set<() => Promise<void>>();
	private readonly core: CoreDriver;
	private readonly sysPlaces: SystemPlaces;
	private readonly appDownloader: AppDownloader;
	private readonly platform = new PlatformDownloader();

	constructor(
		makeDriver: typeof makeCoreDriver, conf: CoreConf,
		private readonly devApps: DevAppParams[]|undefined,
		private readonly devToolsFlags: ReturnType<typeof getDevToolFlag>
	) {
		this.sysPlaces = new SystemPlaces(() => this.core.storages);
		this.appDownloader = new AppDownloader(this.sysPlaces);
		this.core = makeDriver(
			conf, this.openViewer, this.appsCapFns(), this.logout
		);
		Object.seal(this);
	}

	private shouldEnableDevToolsIn(appDomain: string): boolean {
		// XXX there should be app-specific flags
		return this.devToolsFlags;
	}

	findOpenedApp(appDomain: string): AppInstance|undefined {
		return this.apps.get(appDomain);
	}

	isTopLevelWebContent = (webContents: WebContents): boolean => {
		for (const app of this.apps.values()) {
			if (app.window.webContents === webContents) {
				return true;
			}
		}
		return false;
	}

	private registerApp(app: AppInstance): void {
		this.apps.set(app.domain, app);
		app.window.on('closed', () => {
			this.apps.delete(app.domain);
		});
	}

	private readonly openViewer = async (
		fs: FS, path: string, itemType: 'file'|'folder',
		winOpts?: web3n.ui.WindowOptions, devTools = false
	): Promise<void> => {
		const viewer = await ViewerInstance.makeInWindow(
			fs, path, itemType, winOpts, devTools);
		this.registerViewer(viewer);
		viewer.loadContent();
	}

	private registerViewer(viewer: ViewerInstance): void {
		this.viewers.add(viewer);
		viewer.window.on('closed', () => this.viewers.delete(viewer));
	}

	async openStartupApp(): Promise<{ coreInit: Promise<void>; }> {
		if (this.core.isStarted()
		|| this.findOpenedApp(STARTUP_APP_DOMAIN)
		|| this.appStartingProcs.getP(STARTUP_APP_DOMAIN)) {
			throw new Error(`Startup was already started`);
		}
		const devParams = (this.devApps ?
			this.devApps.find(
				app => (app.manifest.appDomain == STARTUP_APP_DOMAIN)) :
			undefined);
		const openningProc = (devParams ?
			this.instantiateDevStartup(devParams) :
			this.instantiateStartup(
				this.shouldEnableDevToolsIn(STARTUP_APP_DOMAIN)
			));
		return this.appStartingProcs.addStarted(STARTUP_APP_DOMAIN, openningProc);
	}

	private async instantiateStartup(
		devTools: boolean
	): Promise<{ coreInit: Promise<void>; }> {
		try {
			const { manifest, appRoot } = await appAndManifestOnDev(
				join(BUNDLED_APPS_FOLDER, reverseDomain(STARTUP_APP_DOMAIN)));
			const { capsForStartup, coreInit } = this.core.start();
			const startupApp = await AppInstance.makeStartupInWindow(
				STARTUP_APP_DOMAIN, appRoot, manifest.windowOpts, devTools
			);
			this.connectors.connectStartupW3N(
				capsForStartup, startupApp.window.webContents
			);
			this.registerApp(startupApp);
			await startupApp.loadContent();
			return { coreInit };
		} catch (err) {
			throw errWithCause(err, `Cannot open startup app`);
		}
	}

	private async instantiateDevStartup(
		devParams: DevAppParams
	): Promise<{ coreInit: Promise<void>; }> {
		try {
			const { manifest, rootUrl, rootFolder } = devParams;
			const { capsForStartup, coreInit } = this.core.start(true);
			let startupApp: AppInstance;
			if (rootUrl) {
				startupApp = await DevAppInstanceFromUrl.makeStartupFor(
					STARTUP_APP_DOMAIN, rootUrl, manifest.windowOpts
				);
			} else {
				const appRoot = await DeviceFS.makeReadonly(rootFolder!);
				startupApp = await AppInstance.makeStartupInWindow(
					STARTUP_APP_DOMAIN, appRoot, manifest.windowOpts, true
				);
			}
			this.connectors.connectStartupW3N(
				capsForStartup, startupApp.window.webContents
			);
			this.registerApp(startupApp);
			await startupApp.loadContent();
			return { coreInit };
		} catch (err) {
			throw errWithCause(err, `Cannot open startup app`);
		}
	}

	private async openApp(appDomain: string, devTools = false): Promise<void> {
		if (!devTools) {
			devTools = this.shouldEnableDevToolsIn(appDomain);
		}
		const app = this.findOpenedApp(appDomain);
		if (app) {
			app.window.focus();
			return;
		}

		const startedProc = this.appStartingProcs.getP<void>(appDomain);
		if (startedProc) {
			return startedProc;
		}

		const devParams = (this.devApps ?
			this.devApps.find(app => (appDomain === app.manifest.appDomain)) :
			undefined);
		const startingApp = (devParams ?
			this.instantiateDevApp(devParams) :
			this.instantiateApp(appDomain, devTools)
		).then(
			app => app.window.focus(),
			(err: AppInitException) => {
				if (err.type === 'app-init') {
					throw err;
				} else {
					throw makeAppInitExc(appDomain, {}, err);
				}
			}
		);
		return this.appStartingProcs.addStarted(appDomain, startingApp);
	}

	private async instantiateApp(
		appDomain: string, devTools: boolean
	): Promise<AppInstance> {
		const {
			appRoot, manifest
		} = await this.sysPlaces.findInstalledApp(appDomain)
		.catch(async (exc: AppInitException) => {
			if (exc.notInstalled) {
				const {
					bundleUnpack$, download$, version
				} = await this.getAppWebPack(appDomain);
				// XXX note that we may wat to add process observation to openApp's
				//     instead of just non-responsive await below
				if (bundleUnpack$) {
					await bundleUnpack$.toPromise();
				}
				if (download$) {
					await download$.toPromise();
				}
				await this.sysPlaces.installWebApp(appDomain, version);
				return this.sysPlaces.findInstalledApp(appDomain);
			} else {
				throw exc;
			}
		});
		const caps = this.core.makeCAPsForApp(appDomain, manifest, devTools);
		const app = await AppInstance.makeInWindow(
			appDomain, appRoot, caps, manifest.windowOpts, undefined, devTools
		);
		this.connectors.connectW3N(app.w3n, app.window.webContents);
		this.registerApp(app);
		await app.loadContent(manifest.content);
		return app;
	}

	private async instantiateDevApp(
		devParams: DevAppParams
	): Promise<AppInstance> {
		const { manifest, rootFolder, rootUrl } = devParams;
		const appDomain = manifest.appDomain;
		const caps = this.core.makeCAPsForApp(appDomain, manifest, true);
		let app: AppInstance;
		if (rootUrl) {
			app = await DevAppInstanceFromUrl.makeForUrl(
				appDomain, rootUrl, caps, manifest.windowOpts, undefined
			);
		} else {
			const appRoot = await DeviceFS.makeReadonly(rootFolder!);
			app = await AppInstance.makeInWindow(
				appDomain, appRoot, caps, manifest.windowOpts, undefined, true
			);
		}
		this.connectors.connectW3N(app.w3n, app.window.webContents);
		this.registerApp(app);
		await app.loadContent(devParams.manifest.content);
		return app;
	}

	async openAppMenuApp(): Promise<void> {
		await this.openApp(APPS_MENU_DOMAIN);
	}

	private async getAppWebPack(
		appDomain: string
	): Promise<{
		version: string;
		bundleUnpack$?: Observable<BundleUnpackProgress>;
		download$?: Observable<DownloadProgress>;
	}> {
		const info = await this.sysPlaces.getAppInfo(appDomain);
		if (info) {
			// check if pack is already present
			if (info.packs) {
				const version = latestVersionInPacks(info.packs, 'web');
				if (version) {
					return { version };
				}
			}
			// check if there is a bundle to unpack
			if (info.bundled) {
				const bundle = info.bundled
				.find(b => (!b.isLink && (b.platform === 'web')));
				if (bundle) {
					const bundleUnpack = new Subject<BundleUnpackProgress>();
					this.sysPlaces.unpackBundledWebApp(appDomain, bundleUnpack);
					return {
						version: bundle.version,
						bundleUnpack$: bundleUnpack.asObservable()
					};
				}
			}
		}
		// download pack
		const channels = await this.appDownloader.getAppChannels(appDomain);
		const channel = (channels.main ? channels.main : 'latest');
		const version = await this.appDownloader.getLatestAppVersion(
			appDomain, channel);
		const download = new Subject<DownloadProgress>();
		this.appDownloader.downloadWebApp(appDomain, version, download);
		return {
			version,
			download$: download.asObservable()
		};
	}

	async exit(exitCode = 0): Promise<void> {
		let appMenu: AppInstance|undefined = undefined;
		for (const app of this.apps.values()) {
			// electron 10 breaks when all windows get close()-d, hence
			// we keep app menu open till after core correctly closes.
			if (app.domain === APPS_MENU_DOMAIN) {
				appMenu = app;
			} else {
				app.window.close();
			}
		}
		for (const cb of this.callbacksOnExit) {
			await cb().catch(logError);
		}
		await this.core.close().catch(logError);
		if (appMenu) {
			try {
				appMenu.window.close();
			} catch (err) {}
		}
		// note that when everything is closed, platform will exit even before
		// call to app.exit()
		setTimeout(async () => {
			app.exit(exitCode);
		}, 3000).unref();
	}

	attachCleanupOnExit(cb: () => Promise<void>): void {
		this.callbacksOnExit.add(cb);
	}

	detachCleanupOnExit(cb: () => Promise<void>): void {
		this.callbacksOnExit.delete(cb);
	}

	private readonly logout = async (closePlatform: boolean): Promise<void> => {
		// for now platform is closed anyway
		this.exit();	// we don't wait for this to end
	};

	private appsCapFns(): web3n.ui.Apps {
		return {
			opener: {
				listApps: this.sysPlaces.listApps.bind(this.sysPlaces),
				openApp: this.openApp.bind(this),
				getAppIcon: this.sysPlaces.getAppIcon.bind(this.sysPlaces),
				getAppInfo: this.sysPlaces.getAppInfo.bind(this.sysPlaces),
			},
			downloader: {
				downloadWebApp: this.appDownloader.downloadWebApp.bind(
					this.appDownloader),
				getAppChannels: this.appDownloader.getAppChannels.bind(
					this.appDownloader),
				getLatestAppVersion: this.appDownloader.getLatestAppVersion.bind(
					this.appDownloader),
				getAppVersionList: this.appDownloader.getAppVersionList.bind(
					this.appDownloader)
			},
			installer: {
				unpackBundledWebApp: this.sysPlaces.unpackBundledWebApp.bind(
					this.sysPlaces),
				installWebApp: this.sysPlaces.installWebApp.bind(this.sysPlaces),
			},
			platform: {
				getCurrentVersion: async () => app.getVersion(),
				getChannels: this.platform.getChannels.bind(this.platform),
				getLatestVersion: this.platform.getLatestVersion.bind(
					this.platform),
				getVersionList: this.platform.getVersionList.bind(this.platform),
				availableUpdateType: this.platform.availableUpdateType.bind(
					this.platform),
				downloadAndApplyUpdate: this.platform.downloadAndApplyUpdate.bind(
					this.platform)
			}
		};
	}

	async createTray(): Promise<void> {

		// XXX we may pass a stream of updated recent apps list

		const { closeTray, trayEvent$ } = createTray(this.core.getUserId());
		this.attachCleanupOnExit(async () => closeTray());
		trayEvent$.subscribe({ next: async ev => {
			try {
				if (ev === 'apps-menu') {
					await this.openAppMenuApp();
				} else if (ev === 'logout') {
					await this.logout(true);
				} else if (ev === 'close-all-apps') {
					for (const app of this.apps.values()) {
						app.window.close();
					}
				} else {
					await this.openApp(ev.app);
				}
			} catch (err) {
				await logError(err, `Error occured in handling tray clicks`);
			}
		} });
	}

}
Object.freeze(InitProc.prototype);
Object.freeze(InitProc);


async function appAndManifestOnDev(
	path: string
): ReturnType<typeof appAndManifestFrom> {
	const appFS = await DeviceFS.makeReadonly(path);
	return appAndManifestFrom(appFS);
}

type AppInfo = web3n.ui.AppInfo;
type PlatformType = web3n.ui.PlatformType;
type BundleUnpackProgress = web3n.ui.BundleUnpackProgress;
type DownloadProgress = web3n.ui.DownloadProgress;

function latestVersionInPacks(
	packs: NonNullable<AppInfo['packs']>, platform: PlatformType
): string|undefined {
	const webVersions = packs
	.filter(info => (info.platform === platform))
	.map(info => info.version);
	return ((webVersions.length > 0) ? latestVersionIn(webVersions) : undefined);
}


Object.freeze(exports);