/*
 Copyright (C) 2017 3NSoft Inc.
 
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

import { BrowserWindow } from 'electron';
import { makeSessionForApp } from '../lib-client/electron/session';
import { protoSchemas } from "../lib-client/electron/protocols";
import { normalize, join as joinFSPath, posix } from 'path';
import { copy as jsonCopy } from '../lib-common/json-utils';
import { CAPs } from '../main/core';
import { logWarning } from '../lib-client/logging/log-to-file';

type WebContents = Electron.WebContents;
type WindowOptions = web3n.ui.WindowOptions;
type Session = Electron.Session;
type W3N = web3n.ui.W3N;

export type ExposeW3N = (webContents: WebContents, remotedW3N: W3N) => void;

export type RequestFilter = (url: string) => boolean;
export type FS = web3n.files.FS;

const APP_PRELOAD = normalize(`${__dirname}/renderer/preload.js`);

export class AppInstance {

	window: BrowserWindow;
	private children: Set<AppInstance>|undefined;
	private w3n: W3N;

	private constructor(
			public domain: string,
			public parent: AppInstance|undefined,
			private appFilesRoot: string|FS,
			caps: CAPs,
			private exposeW3N: ExposeW3N,
			opts: Electron.BrowserWindowConstructorOptions) {
		this.window = new BrowserWindow(opts);
		this.setupWindow();
		this.setupCAPS(caps);
		Object.seal(this);
	}

	private setupWindow(): void {

		// show window, once everything is ready
		this.window.once('ready-to-show', () => this.window.show());
		
		// prevent opening of new windows
		this.window.webContents.on('new-window',
				async (event: Electron.Event) => {
			await logWarning(
				`Preventing window ${this.window.id} from openning new window.`);
			event.preventDefault();
		});
		
	}

	private setupCAPS(caps: CAPs): void {

		if (caps.close) {
			this.window.on('closed', caps.close);
		}

		if (caps.setAppInstance) {
			caps.setAppInstance(this);
		}

		this.w3n = caps.remotedW3N;
		this.exposeW3N(this.window.webContents, this.w3n);

		if (caps.remotedW3N.openChildWindow) {
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
			domain: string, appFilesRoot: string|FS, caps: CAPs,
			exposeW3N: ExposeW3N, session?: Session, winOpts?: WindowOptions,
			parent?: AppInstance): Promise<AppInstance> {
		if (!session) {
			session = await makeSessionForApp(domain, appFilesRoot);
		}
		const doPreload = (Object.keys(caps.remotedW3N).length > 0);
		const opts = prepareWindowOpts(session, doPreload, winOpts);
		return new AppInstance(
			domain, parent, appFilesRoot, caps, exposeW3N, opts);
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

	get remotedW3N(): W3N {
		return this.w3n;
	}

	async makeChildInWindow(subroot: string|null, caps: CAPs,
			winOpts?: WindowOptions): Promise<AppInstance> {
		if (!this.children) { throw new Error(
			`This app cannot make child windows`); }
		
		const doPreload = (Object.keys(caps.remotedW3N).length > 0);
		
		let child: AppInstance;
		// make session for subroot, else, share session, name, and root
		if (subroot) {
			let childFilesRoot: string|FS;
			if (typeof this.appFilesRoot === 'string') {
				childFilesRoot = joinFSPath(
					this.appFilesRoot,
					joinFSPath('/', subroot));
			} else {
				childFilesRoot = await this.appFilesRoot.readonlySubRoot(
					posix.join('/', subroot));
			}
			const childDomain = subrootToAppDomain(this.domain, subroot);
			const session = await makeSessionForApp(childDomain, childFilesRoot);
			const opts = prepareWindowOpts(
				session, doPreload, winOpts, this.window);
			child = new AppInstance(
				childDomain, this, childFilesRoot, caps, this.exposeW3N, opts);
		} else {
			const opts = prepareWindowOpts(
				this.window.webContents.session, doPreload, winOpts, this.window);
			child = new AppInstance(
				this.domain, this, this.appFilesRoot, caps, this.exposeW3N, opts);
		}

		this.registerChild(child);
		return child;
	}

	private registerChild(child: AppInstance): void {
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

function prepareWindowOpts(session: Session, doPreload: boolean,
		winOpts?: WindowOptions, parent?: BrowserWindow):
		Electron.BrowserWindowConstructorOptions {
	// make a sanitized copy
	const opts = copyWinOpts(winOpts);
	
	if (parent && winOpts && (winOpts.alwaysAboveParent || winOpts.modal)) {
		opts.parent = parent;
	}

	opts.webPreferences = {};
	if (doPreload) {
		opts.webPreferences.preload = APP_PRELOAD;
	}
	// XXX allow sandbox when issue #99 resolves, when electron is ready
	// opts.webPreferences.sandbox = true;
	opts.webPreferences.defaultEncoding = 'UTF-8';
	opts.webPreferences.nodeIntegration = false;
	opts.webPreferences.session = session;
	opts.show = false;

	return opts;
}

/**
 * This makes a copy of only whitelisted options from given options, and
 * returns said copy as options for electron's window.
 * @param winOpts are window options that are copied in a sanitizing way.
 */
export function copyWinOpts(winOpts: WindowOptions|undefined):
		Electron.BrowserWindowConstructorOptions {
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
	.concat(...subroot.split('/'));
	for (let i=0; i<domainChunks.length; i+=1) {
		if (domainChunks[i]) { continue; }
		domainChunks.splice(i, 1);
		i -= 1;
	}
	return domainChunks.reverse().join('.');
}

Object.freeze(exports);