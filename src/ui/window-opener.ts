/*
 Copyright (C) 2016 3NSoft Inc.
 
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
import { pathStaysWithinItsRoot } from '../lib-client/local-files/device-fs';
import { StoragePolicy } from '../main/storage/index';

export abstract class WindowOpener {
	
	win: Electron.BrowserWindow;
	protected urlRoot: string = null;
	
	/**
	 * @param name is this app's name
	 * @param preload is a location of preload script, i.e. script that runs
	 * before node elements are removed from page's global object.
	 * @param opts is an optional object with options for a new window. 
	 */
	constructor(
			public name: string,
			preload: string,
			opts: Electron.BrowserWindowOptions = {}) {
		
		// set important parts of options
		if (opts.webPreferences) {
			opts.webPreferences.nodeIntegration = false;
			opts.webPreferences.defaultEncoding = 'UTF-8';
			opts.webPreferences.preload = preload;
		} else {
			opts.webPreferences = {
				nodeIntegration: false,
				defaultEncoding: 'UTF-8',
				preload: preload
			}
		}
		
		this.win = new BrowserWindow(opts);
		
		// prevent opening of new windows
		this.win.webContents.on('new-window', (event: Electron.Event) => {
			console.warn(`Preventing window ${this.win.id} from openning new window.`);
			event.preventDefault();
		});
		
		this.win.webContents.on('will-navigate', (event, url) => {
			if (this.urlRoot !== null) {
				if ((url.indexOf(this.urlRoot) !== 0) ||
						!pathStaysWithinItsRoot(url.substring(this.urlRoot.length))) {
					console.warn(`Preventing window ${this.win.id} from reloading to new url ${url} which is outside of window's allowed root.`);
					event.preventDefault();
					return;
				}
			} else {
				console.warn(`Preventing window ${this.win.id} from reloading to new url ${url} as allowable root is not set.`);
				event.preventDefault();
				return;
			}
		});
		
	}
	
	abstract getStoragePolicy(): StoragePolicy;
	
}
Object.freeze(WindowOpener.prototype);
Object.freeze(WindowOpener);

Object.freeze(exports);