/*
 Copyright (C) 2017, 2021 3NSoft Inc.
 
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
import { makeSessionForViewer } from '../electron/session';
import { protoSchemas } from "../electron/protocols";
import { copyWinOpts } from './app-instance';
import { logWarning } from '../confs';
import { addDevToolsShortcuts } from './devtools';

type WindowOptions = web3n.ui.WindowOptions;
type Session = Electron.Session;
type FS = web3n.files.FS;

export class ViewerInstance {

	window: BrowserWindow;

	private constructor(
		private path: string,
		private itemType: 'file'|'folder',
		opts: Electron.BrowserWindowConstructorOptions
	) {
		this.window = new BrowserWindow(opts);
		this.setupWindow();
		Object.seal(this);
	}

	private setupWindow(): void {

		// show window, once everything is ready
		this.window.once('ready-to-show', () => this.window.show());
		
		// prevent opening of new windows
		this.window.webContents.on('new-window', async event => {
			await logWarning(
				`Preventing window ${this.window.id} from openning new window.`);
			event.preventDefault();
		});
	}

	static async makeInWindow(
		fs: FS, path: string, itemType: 'file'|'folder',
		winOpts: WindowOptions|undefined, devTools: boolean
	): Promise<ViewerInstance> {
		if (!path.startsWith('/')) {
			path = `/${path}`;
		}
		const session = makeSessionForViewer(fs, path, itemType, devTools);
		const opts = prepareWindowOpts(session, winOpts, devTools);
		const viewer = new ViewerInstance(path, itemType, opts);
		if (devTools) {
			addDevToolsShortcuts(viewer.window);
		}
		return new ViewerInstance(path, itemType, opts);
	}

	async loadContent(): Promise<void> {
		const url = `${protoSchemas.W3N_FS.scheme}://${this.itemType}${this.path}`;
		await this.window.loadURL(url);
	}

}
Object.freeze(ViewerInstance.prototype);
Object.freeze(ViewerInstance);

function prepareWindowOpts(
	session: Session, winOpts: WindowOptions|undefined, devTools: boolean
): Electron.BrowserWindowConstructorOptions {
	// make a sanitized copy
	const opts = copyWinOpts(winOpts);
	
	opts.webPreferences = {
		contextIsolation: true,
		sandbox: true,
		session,
		devTools
	};
	opts.show = false;

	return opts;
}

Object.freeze(exports);