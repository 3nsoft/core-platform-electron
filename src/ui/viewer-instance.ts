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
import { makeSessionForViewer } from '../lib-client/electron/session';
import { protoSchemas } from "../lib-client/electron/protocols";
import { logWarning } from '../lib-client/logging/log-to-file';
import { copyWinOpts } from './app-instance';

type WindowOptions = web3n.ui.WindowOptions;
type Session = Electron.Session;
type FS = web3n.files.FS;

export class ViewerInstance {

	window: BrowserWindow;

	private constructor(
			private path: string,
			private itemType: 'file'|'folder',
			opts: Electron.BrowserWindowConstructorOptions) {
		this.window = new BrowserWindow(opts);
		this.setupWindow();
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

	static async makeInWindow(fs: FS, path: string, itemType: 'file'|'folder',
			winOpts?: WindowOptions): Promise<ViewerInstance> {
		if (!path.startsWith('/')) {
			path = `/${path}`;
		}
		const session = await makeSessionForViewer(fs, path, itemType);
		const opts = prepareWindowOpts(session, winOpts);
		return new ViewerInstance(path, itemType, opts);
	}

	loadContent(): void {
		const url = `${protoSchemas.W3N_FS}://${this.itemType}${this.path}`;
		this.window.loadURL(url);
		setTimeout(() => {
			this.window.webContents.openDevTools();
		}, 1000);
	}

}
Object.freeze(ViewerInstance.prototype);
Object.freeze(ViewerInstance);

function prepareWindowOpts(session: Session, winOpts?: WindowOptions):
		Electron.BrowserWindowConstructorOptions {
	// make a sanitized copy
	const opts = copyWinOpts(winOpts);
	
	opts.webPreferences = {};
	opts.webPreferences.sandbox = true;
	opts.webPreferences.nodeIntegration = false;
	opts.webPreferences.session = session;
	opts.show = false;

	return opts;
}

Object.freeze(exports);