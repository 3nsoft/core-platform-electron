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

import { normalize } from 'path';

export interface StoragePolicy {
	canOpenAppFS(appFolder: string, type: 'local'|'synced'): boolean;
	canOpenUserFS?: (type: web3n.storage.StorageType) => 'w'|'r'|false;
	canOpenSysFS?: (type: web3n.storage.StorageType) => 'w'|'r'|false;
}

export const CLIENT_APP_DOMAIN = '3nweb.computer';

export const STARTUP_APP_DOMAIN = 'startup.3nweb.computer';

export interface AppManifest {
	appDomain: string;
	name: string;

	content?: string;

	capsRequested: {
		device?: DeviceCAPSetting;
		mail?: MailCAPSetting;
		openViewer?: 'all' | { mimeWhitelist: string[]; };
		openWithOSApp?: 'all' | { mimeWhitelist: string[]; };
		openChildWindow?: 'all';
		storage?: StorageCAPSetting;
	};

	windowOpts?: web3n.ui.WindowOptions;

	sharedLibs?: SharedLibInfo[];
}

export interface StorageCAPSetting {
	appFS: 'default' | AppFSSetting[];
	userFS?: 'all'|FSSetting[];
	sysFS?: 'all'|FSSetting[];
}

export interface AppFSSetting {
	domain: string;
	storage: 'synced' | 'local' | 'synced-n-local';
}

export interface FSSetting {
	type: web3n.storage.StorageType;
	writable: boolean;
}

export interface MailCAPSetting {
	sendingTo?: 'all' | { whitelist: string[]; };
	receivingFrom?: 'all' | { whitelist: string[]; };
}

export interface DeviceCAPSetting {
	fileDialog?: 'all';
}

export interface SharedLibInfo {
	libDomain: string;
	version: { hash: string; alg: string; }
}

Object.freeze(exports);