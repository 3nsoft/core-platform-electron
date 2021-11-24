/*
 Copyright (C) 2017 - 2021 3NSoft Inc.
 
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

import { BrowserWindow } from 'electron';
import { makeSessionForApp, makeSessionForDevAppFromUrl } from '../electron/session';
import { protoSchemas } from "../electron/protocols";
import { join, posix } from 'path';
import { copy as jsonCopy } from '../lib-common/json-utils';
import { logWarning } from '../confs';
import { AppCAPsAndSetup } from '../core/core-driver';
import { addDevToolsShortcuts } from './devtools';

type WindowOptions = web3n.ui.WindowOptions;
type Session = Electron.Session;
type W3N = web3n.ui.W3N;

export type RequestFilter = (url: string) => boolean;
export type FS = web3n.files.FS;

const dirWithPreloads = join(__dirname, '..', 'renderer');
const APP_PRELOAD = join(dirWithPreloads, 'preload.js');
const STARTUP_APP_PRELOAD = join(dirWithPreloads, 'preload-for-startup.js');

export class AppInstance {

	public readonly window: BrowserWindow;
	protected children: Set<AppInstance>|undefined;
	public readonly w3n: W3N;
	public readonly devToolsEnabled: boolean;

	protected constructor(
		public readonly domain: string,
		public readonly parent: AppInstance|undefined,
		private readonly appFilesRoot: FS,
		caps: AppCAPsAndSetup|undefined,
		opts: Electron.BrowserWindowConstructorOptions
	) {
		this.window = new BrowserWindow(opts);
		this.devToolsEnabled = !!opts.webPreferences!.devTools;
		this.setupWindow(caps);
		this.w3n = (caps ? caps.w3n : undefined as any);
		// seal this in static make calls
	}

	private setupWindow(caps: AppCAPsAndSetup|undefined): void {

		// show window, once everything is ready
		this.window.once('ready-to-show', () => this.window.show());
		
		// prevent opening of new windows
		this.window.webContents.on('new-window', async event => {
			await logWarning(
				`Preventing window ${this.window.id} from openning new window.`);
			event.preventDefault();
		});

		this.attachCAPS(caps);
		
	}

	private attachCAPS(caps: AppCAPsAndSetup|undefined): void {
		if (!caps) { return; }
		if (caps.close) {
			this.window.on('closed', caps.close);
		}
		caps.setApp(this);
		if (caps.w3n.openChildWindow) {
			this.children = new Set<AppInstance>();
			this.setupChildren();
		}
	}

	private setupChildren(): void {
		this.window.on('closed', () => {
			for (const child of this.children!) {
				if (child.window.isDestroyed()) { continue; }
				child.window.destroy();
			}
			this.children = undefined;
		});
	}

	static async makeInWindow(
		domain: string, appRoot: FS, caps: AppCAPsAndSetup,
		winOpts: WindowOptions|undefined, parent: AppInstance|undefined,
		devTools: boolean
	): Promise<AppInstance> {
		const session = makeSessionForApp(domain, appRoot, devTools);
		const preload = ((Object.keys(caps.w3n).length > 0) ?
			APP_PRELOAD : undefined);
		const opts = prepareWindowOpts(
			session, preload, winOpts, undefined, devTools);
		const app = new AppInstance(domain, parent, appRoot, caps, opts);
		await app.attachDevTools(session);
		Object.seal(app);
		return app;
	}

	static async makeStartupInWindow(
		domain: string, appRoot: FS, winOpts: WindowOptions|undefined,
		devTools: boolean
	): Promise<AppInstance> {
		const session = makeSessionForApp(domain, appRoot, devTools);
		const opts = prepareWindowOpts(
			session, STARTUP_APP_PRELOAD, winOpts, undefined, devTools
		);
		const app = new AppInstance(domain, undefined, appRoot, undefined, opts);
		await app.attachDevTools(session);
		Object.seal(app);
		return app;
	}

	protected async attachDevTools(session: Session): Promise<void> {
		if (this.devToolsEnabled) {
			addDevToolsShortcuts(this.window);
		}
	}

	async loadContent(path?: string): Promise<void> {
		if (typeof path === 'string') {
			if (!path.startsWith('/')) {
				path = `/${path}`;
			}
		} else {
			path = '/index.html';
		}
		const url = `${protoSchemas.W3N_APP.scheme}://${this.domain}${path}`;
		await this.window.loadURL(url);
	}

	async makeChildInWindow(
		subroot: string|null, caps: AppCAPsAndSetup,
		winOpts: WindowOptions|undefined
	): Promise<AppInstance> {
		if (!this.children) { throw new Error(
			`This app cannot make child windows`); }
		
		const preload = ((Object.keys(caps.w3n).length > 0) ?
			APP_PRELOAD : undefined);
		
		let child: AppInstance;
		// subroot limits child, hence we make new session,
		// but without subroot we share session, name, and root
		if (subroot) {
			const childAppRoot = await this.appFilesRoot.readonlySubRoot(subroot);
			const childDomain = subrootToAppDomain(this.domain, subroot);
			const session = makeSessionForApp(
				childDomain, childAppRoot, this.devToolsEnabled);
			const opts = prepareWindowOpts(
				session, preload, winOpts, this.window, this.devToolsEnabled);
			child = new AppInstance(
				childDomain, this, childAppRoot, caps, opts);
		} else {
			const opts = prepareWindowOpts(
				this.window.webContents.session, preload, winOpts, this.window,
				this.devToolsEnabled);
			child = new AppInstance(
				this.domain, this, this.appFilesRoot, caps, opts);
		}

		this.registerChild(child);
		return child;
	}

	protected registerChild(child: AppInstance): void {
		this.children!.add(child);
		child.window.on('closed', () => {
			if (this.children) {
				this.children.delete(child);
			}
		});
	}

}
Object.freeze(AppInstance.prototype);
Object.freeze(AppInstance);


function prepareWindowOpts(
	session: Session, preload: string|undefined,
	winOpts: WindowOptions|undefined, parent: BrowserWindow|undefined,
	devTools: boolean
): Electron.BrowserWindowConstructorOptions {
	// make a sanitized copy
	const opts = copyWinOpts(winOpts);
	
	if (parent && winOpts && (winOpts.alwaysAboveParent || winOpts.modal)) {
		opts.parent = parent;
	}

	opts.webPreferences = {
// XXX debug value, want to run it with sandbox and in isolated context
contextIsolation: false,
sandbox: false,
		// contextIsolation: true,
		// sandbox: true,
		nodeIntegration: false,
		devTools,
		session,
		defaultEncoding: 'UTF-8'
	};
	if (preload) {
		opts.webPreferences.preload = preload;
	}
	opts.show = false;

	return opts;
}

/**
 * This makes a copy of only whitelisted options from given options, and
 * returns said copy as options for electron's window.
 * @param winOpts are window options that are copied in a sanitizing way.
 */
export function copyWinOpts(
	winOpts: WindowOptions|undefined
): Electron.BrowserWindowConstructorOptions {
	const opts: Electron.BrowserWindowConstructorOptions = {};
	if (!winOpts) { return opts; }
	for (const optName of Object.keys(winOpts)) {
		if (!winOptsToCopy.has(optName)) { continue; }
		opts[optName] = jsonCopy(winOpts[optName]);
	}
	return opts;
}
const winOptsToCopy = new Set([
	'width', 'height', 'x', 'y', 'useContentSize', 'center',
	'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
	'resizable', 'movable', 'minimizable', 'maximizable',
	'skipTaskbar', 'title', 'icon', 'frame', 'modal',
	'acceptFirstMouse',
	'backgroundColor', 'titleBarStyle', 'thickFrame'
]);

function subrootToAppDomain(initAppDomain: string, subroot: string): string {
	subroot = posix.join('/', subroot);
	const domainChunks = initAppDomain.split('.')
	.reverse()
	.concat(...subroot.split('/'))
	.filter(s => (s.length > 0));
	for (let i=0; i<domainChunks.length; i+=1) {
		if (domainChunks[i]) { continue; }
		domainChunks.splice(i, 1);
		i -= 1;
	}
	return domainChunks.reverse().join('.');
}


export class DevAppInstanceFromUrl extends AppInstance {

	private constructor(
		domain: string, parent: AppInstance|undefined,
		private readonly appFilesDevUrl: string,
		caps: AppCAPsAndSetup|undefined,
		opts: Electron.BrowserWindowConstructorOptions
	) {
		super(domain, parent, undefined as any, caps, opts);
	}

	static async makeForUrl(
		domain: string, appUrl: string, caps: AppCAPsAndSetup,
		winOpts: WindowOptions|undefined, parent: AppInstance|undefined
	): Promise<AppInstance> {
		const session = makeSessionForDevAppFromUrl(appUrl);
		const preload = ((Object.keys(caps.w3n).length > 0) ?
			APP_PRELOAD : undefined);
		const opts = prepareWindowOpts(
			session, preload, winOpts, undefined, true);
		const app = new DevAppInstanceFromUrl(domain, parent, appUrl, caps, opts);
		await app.attachDevTools(session);
		Object.seal(app);
		return app;
	}

	static async makeStartupFor(
		domain: string, appUrl: string, winOpts: WindowOptions|undefined
	): Promise<AppInstance> {
		const session = makeSessionForDevAppFromUrl(appUrl);
		const opts = prepareWindowOpts(
			session, STARTUP_APP_PRELOAD, winOpts, undefined, true
		);
		const app = new DevAppInstanceFromUrl(
			domain, undefined, appUrl, undefined, opts);
		await app.attachDevTools(session);
		Object.seal(app);
		return app;
	}

	async loadContent(path?: string): Promise<void> {
		let url = this.appFilesDevUrl;
		if (typeof path === 'string') {
			if (!url.endsWith('/') && !path.startsWith('/')) {
				url += '/';
			}
			url += path;
		}
		await this.window.loadURL(url);
	}

	async makeChildInWindow(
		subroot: string|null, caps: AppCAPsAndSetup,
		winOpts: WindowOptions|undefined
	): Promise<AppInstance> {
		if (!this.children) { throw new Error(
			`This app cannot make child windows`); }
		
		const preload = ((Object.keys(caps.w3n).length > 0) ?
			APP_PRELOAD : undefined);
		
		let child: AppInstance;
		// subroot limits child, hence we make new session,
		// but without subroot we share session, name, and root
		if (subroot) {
			const childDomain = subrootToAppDomain(this.domain, subroot);
			const appUrl = posix.join(
				this.appFilesDevUrl, posix.join('/', subroot));
			const session = makeSessionForDevAppFromUrl(appUrl);
			const opts = prepareWindowOpts(
				session, preload, winOpts, this.window, this.devToolsEnabled);
			child = new DevAppInstanceFromUrl(
				childDomain, this, appUrl, caps, opts);
		} else {
			const opts = prepareWindowOpts(
				this.window.webContents.session, preload, winOpts, this.window,
				this.devToolsEnabled);
			child = new DevAppInstanceFromUrl(
				this.domain, this, this.appFilesDevUrl, caps, opts);
		}

		this.registerChild(child);
		return child;
	}

}
Object.freeze(DevAppInstanceFromUrl.prototype);
Object.freeze(DevAppInstanceFromUrl);


Object.freeze(exports);