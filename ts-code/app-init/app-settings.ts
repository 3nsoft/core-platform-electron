/*
 Copyright (C) 2017 - 2018, 2021 3NSoft Inc.
 
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

export interface StoragePolicy {
	canOpenAppFS(appFolder: string, type: 'local'|'synced'): boolean;
	canOpenUserFS?: FSChecker;
	canOpenSysFS?: FSChecker;
	canAccessDevicePath?: DevPathChecker;
}

export type FSChecker = (type: web3n.storage.StorageType) => 'w'|'r'|false;

export type DevPathChecker = (path: string) => 'w'|'r'|false;

export const BASE_APP_DOMAIN = '3nweb.computer';

export const APPS_MENU_DOMAIN = 'apps-menu.3nweb.computer';

export const STARTUP_APP_DOMAIN = 'startup.3nweb.computer';

export interface AppManifest {
	appDomain: string;
	name: string;
	version: string;

	content?: string;

	capsRequested: {
		device?: DeviceCAPSetting;
		mail?: MailCAPSetting;
		openViewer?: 'all' | { mimeWhitelist: string[]; };
		openWithOSApp?: 'all' | { mimeWhitelist: string[]; };
		openWithOSBrowser?: 'all';
		openChildWindow?: 'all';
		storage?: StorageCAPSetting;
		apps?: "all" | (keyof web3n.ui.Apps)[];
		logout?: "all";
	};

	windowOpts?: web3n.ui.WindowOptions;

	sharedLibs?: SharedLibInfo[];
}

export interface StorageCAPSetting {
	appFS: 'default' | AppFSSetting[];
	userFS?: 'all'|FSSetting[];
	sysFS?: 'all'|FSSetting[];

	// XXX make FilesOnDeviceSetting|FilesOnDeviceSetting[] and
	// ensure that '*' option is ignored in array
	filesOnDevice?: FilesOnDeviceSetting[];
}

export interface AppFSSetting {
	domain: string;
	storage: 'synced' | 'local' | 'synced-n-local';
}

export interface FSSetting {
	type: web3n.storage.StorageType;
	writable: boolean;
}

export interface FilesOnDeviceSetting {
	path: string;
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