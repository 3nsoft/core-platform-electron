/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

import { AppInstance, FS, RequestFilter, ExposeW3N } from './app-instance';
import { ViewerInstance } from './viewer-instance';
import { AppManifest, CLIENT_APP_DOMAIN, STARTUP_APP_DOMAIN }
	from './app-settings';
import { NamedProcs } from '../lib-common/processes';
import { Core, CAPs, reverseDomain } from '../main/core';
import { normalize } from 'path';
import { DeviceFS } from '../lib-client/local-files/device-fs';
import { errWithCause } from '../lib-common/exceptions/error';

type WebContents = Electron.WebContents;

// XXX may this folder configurable. It may help with deployment, and it
// is definitely useful for having test app and a test startup app in a
// different folder, independent of usable UI apps.
const APPS_FOLDER = normalize(`${__dirname}/../apps`);

const APP_ROOT_FOLDER = 'app';
const MANIFEST_FILE = 'manifest.json';

export class InitProc {
	
	private apps = new Map<string, AppInstance>();
	private viewers = new Set<ViewerInstance>();
	private appStartingProcs = new NamedProcs();
	private remotedW3Ns = new WeakMap<WebContents, any>();
	
	constructor() {
		Object.seal(this);
	}

	findOpenedApp(appDomain: string): AppInstance|undefined {
		return this.apps.get(appDomain);
	}

	getRemotedW3N(webContent: WebContents): any {
		return this.remotedW3Ns.get(webContent);
	}

	async openApp(appDomain: string, appFilesRoot: string|FS, caps: CAPs,
			session?: Electron.Session, winOpts?: web3n.ui.WindowOptions):
			Promise<AppInstance> {
		const app = this.apps.get(appDomain);
		if (app) { return app; }
		
		let openningProc = this.appStartingProcs.getP<AppInstance>(appDomain);
		if (openningProc) { return openningProc; }
		
		openningProc = AppInstance.makeInWindow(
			appDomain, appFilesRoot, caps, this.exposeW3N, session, winOpts)
		.then((app) => {
			this.registerApp(app);
			return app;
		});
		return this.appStartingProcs.addStarted(appDomain, openningProc);
	}

	private exposeW3N: ExposeW3N = (webContents, remotedW3N) => {
		this.remotedW3Ns.set(webContents, remotedW3N);
	};

	private registerApp(app: AppInstance): void {
		this.apps.set(app.domain, app);
		app.window.on('closed', () => {
			this.apps.delete(app.domain);
		});
	}

	async openViewer(fs: FS, path: string, itemType: 'file'|'folder',
			winOpts?: web3n.ui.WindowOptions): Promise<void> {
		const viewer = await ViewerInstance.makeInWindow(
			fs, path, itemType, winOpts);
		this.registerViewer(viewer);
		viewer.loadContent();
	}

	private registerViewer(viewer: ViewerInstance): void {
		this.viewers.add(viewer);
		viewer.window.on('closed', () => {
			this.viewers.delete(viewer);
		});
	}

	async openStartupApp(caps: CAPs): Promise<void> {
		try {
			const appFolder = normalize(
				`${APPS_FOLDER}/${reverseDomain(STARTUP_APP_DOMAIN)}`);
			const appFS = await DeviceFS.makeReadonly(appFolder);
			
			const manifest = await appFS.readJSONFile<AppManifest>(MANIFEST_FILE);
			const appRoot = await appFS.readonlySubRoot(APP_ROOT_FOLDER);

			const startupApp = await this.openApp(
				STARTUP_APP_DOMAIN, appRoot, caps, undefined, manifest.windowOpts);
			startupApp.loadContent();
		} catch (err) {
			throw errWithCause(err, `Cannot open startup app`);
		}
	}

	async openInbuiltApp(appDomain: string,
			makeCAPs: (appDomain: string, manifest: AppManifest) => CAPs):
			Promise<void> {
		try {
			const appFolder = normalize(
				`${APPS_FOLDER}/${reverseDomain(appDomain)}`);
			const appFS = await DeviceFS.makeReadonly(appFolder);
			
			const manifest = await appFS.readJSONFile<AppManifest>(MANIFEST_FILE);
			const appRoot = await appFS.readonlySubRoot(APP_ROOT_FOLDER);

			const caps = makeCAPs(appDomain, manifest);
			
			const app = await this.openApp(
				appDomain, appRoot, caps, undefined, manifest.windowOpts);
			
			app.loadContent(manifest.content);
		} catch (err) {
			throw errWithCause(err, `Cannot open an inbuilt app with domain ${appDomain}`);
		}
	}

}
Object.freeze(InitProc.prototype);
Object.freeze(InitProc);

Object.freeze(exports);