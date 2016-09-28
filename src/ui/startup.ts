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
 
/**
 * This module is for opening startup window, to initialize the core.
 */

import { WindowOpener } from './window-opener';
import { bind } from '../lib-common/binding';
import { StoragePolicy } from '../main/storage/index';
import { resolve } from 'path';

const APP_PRELOAD = resolve(__dirname, '../renderer/preload/startup.js');
const APP_URL = `file://${resolve(__dirname, '../apps/startup/index.html')}`;

export class StartupWin extends WindowOpener {

	static APP_NAME = 'computer.3nweb.startup';
		
	constructor() {
		super(StartupWin.APP_NAME, APP_PRELOAD, {
			width: 1200,
			height: 700
		});
		this.win.loadURL(APP_URL);
		Object.freeze(this);
	}
	
	getStoragePolicy(): StoragePolicy {
		let policy: StoragePolicy = {
			canOpenAppFS(appName: string): boolean { return false; }
		};
		Object.freeze(policy);
		return policy;
	}
	
}

Object.freeze(exports);