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
import { stringify as toQuery } from 'querystring';

const APP_PRELOAD = resolve(__dirname, '../renderer/preload/client.js');
const APP_URL_ROOT = `file://${resolve(__dirname, '../apps/client')}/`;
const APP_URL = `${APP_URL_ROOT}index.html`;

const allowedAppFS = [
	'computer.3nweb.mail',
	'computer.3nweb.contacts',
	'computer.3nweb.test'
];
Object.freeze(allowedAppFS);

export class ClientWin extends WindowOpener {

	static APP_NAME = 'computer.3nweb.client';
	
	constructor(preload = APP_PRELOAD, urlArgs?: any) {
		super(ClientWin.APP_NAME, preload, {
			width: 1200,
			height: 700
		});
		this.urlRoot = APP_URL_ROOT
		if (urlArgs) {
			this.win.loadURL(`${APP_URL}?${toQuery(urlArgs)}`);
		} else {
			this.win.loadURL(APP_URL);
		}
		Object.freeze(this);
	}
	
	getStoragePolicy(): StoragePolicy {
		let policy: StoragePolicy = {
			canOpenAppFS(appName: string): boolean {
				return (allowedAppFS.indexOf(appName) >= 0);
			}
		};
		Object.freeze(policy);
		return policy;
	}
	
}
Object.freeze(ClientWin.prototype);
Object.freeze(ClientWin);

Object.freeze(exports);