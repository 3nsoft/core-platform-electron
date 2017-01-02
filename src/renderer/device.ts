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

import { Duplex } from '../lib-common/ipc/electron-ipc';
import { Proxies, FileDetails } from './storage';
import { device } from './common';

type File = web3n.files.File;
type FileTypeFilter = web3n.device.files.FileTypeFilter;

const names = device.uiReqNames.files;

export function makeDeviceOnUISide(core: Duplex, proxies: Proxies) {
	let dev = {
		
		async openFileDialog(title: string, btnLabel: string,
				multiSelections: boolean, filters?: FileTypeFilter[]):
				Promise<File[]|undefined> {
			let req: device.OpenFileDialogRequest = {
				title, btnLabel, multiSelections, filters
			};
			let fInfos = await core.makeRequest<FileDetails[]|undefined>(
				names.openFileDialog, req);
			if (!fInfos) { return; }
			let files: File[] = [];
			for (let fInfo of fInfos) {
				files.push(proxies.getFile(fInfo));
			}
			return files;
		},

		async saveFileDialog(title: string, btnLabel: string, defaultPath: string,
				filters?: FileTypeFilter[]): Promise<File|undefined> {
			let req: device.SaveFileDialogRequest = {
				title, btnLabel, defaultPath, filters
			};
			let fInfo = await core.makeRequest<FileDetails|undefined>(
				names.saveFileDialog, req);
			if (!fInfo) { return; }
			let file = proxies.getFile(fInfo);
			return file;
		}
		
	};
	Object.freeze(dev);
	return dev;
}

Object.freeze(exports);