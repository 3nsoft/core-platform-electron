/*
 Copyright (C) 2016 - 2017, 2020 3NSoft Inc.

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

import { dialog } from 'electron';
import { basename, dirname } from 'path';
import { stat as fsStat } from '../lib-common/async-fs-node';
import { DeviceFS } from 'core-3nweb-client-lib';
import { FileException } from '../lib-common/exceptions/file';
import { AppInstance } from '../app-init/app-instance';
import { AppSetter } from '../core/core-driver';

export interface Device {
	openFileDialog: web3n.device.files.OpenFileDialog;
	openFolderDialog: web3n.device.files.OpenFolderDialog;
	saveFileDialog: web3n.device.files.SaveFileDialog;
	saveFolderDialog: web3n.device.files.SaveFolderDialog;
}

export interface DeviceFileOpener {
	cap: Device;
	setApp: AppSetter;
	close(): void;
}

export function makeDeviceFileOpener(): DeviceFileOpener {
	return (new DevFileOpener()).wrap();
}

type BrowserWindow = Electron.BrowserWindow;
type FileTypeFilter = web3n.device.files.FileTypeFilter;
type WritableFile = web3n.files.WritableFile;
type ReadonlyFile = web3n.files.ReadonlyFile;
type WritableFS = web3n.files.WritableFS;
type ReadonlyFS = web3n.files.ReadonlyFS;

class DevFileOpener {

	private win: BrowserWindow|undefined = undefined;

	constructor() {
		Object.seal(this);
	}

	wrap(): DeviceFileOpener {
		return {
			cap: {
				openFileDialog: this.openFileDialog.bind(this),
				openFolderDialog: this.openFolderDialog.bind(this),
				saveFileDialog: this.saveFileDialog.bind(this),
				saveFolderDialog: this.saveFolderDialog.bind(this),
			},
			setApp: this.setAppInstance.bind(this),
			close: (): void => {
				this.win = undefined;
			}
		};
	}

	private setAppInstance(app: AppInstance): void {
		if (this.win) { throw new Error(`Window instance is already set`); }
		this.win = app.window;
	}

	async openFileDialog(
		title: string, buttonLabel: string, multiSelections: boolean,
		filters?: FileTypeFilter[]
	): Promise<ReadonlyFile[]|undefined> {
		const res = await this.openningDialog(
			'file', title, buttonLabel, multiSelections, filters);
		if (res.canceled || (res.filePaths.length === 0)) { return; }
		const files: ReadonlyFile[] = [];
		for (const path of res.filePaths) {
			files.push(await makeFileFor(path, true, false));
		}
		return files;
	}

	async openFolderDialog(
		title: string, buttonLabel: string, multiSelections: boolean,
		filters?: FileTypeFilter[]
	): Promise<WritableFS[]|undefined> {
		const res = await this.openningDialog(
			'fs', title, buttonLabel, multiSelections, filters);
		if (res.canceled || (res.filePaths.length === 0)) { return; }
		const folders: WritableFS[] = [];
		for (const path of res.filePaths) {
			folders.push(await makeFolderFor(path, true, true) as WritableFS);
		}
		return folders;
	}

	private async openningDialog(
		type: 'file'|'fs', title: string, buttonLabel: string,
		multiSelections: boolean, filters?: FileTypeFilter[]
	): Promise<Electron.OpenDialogReturnValue> {
		if (!this.win || this.win.isDestroyed()) { throw new Error(
			`Parent window is either not set, or is already gone`); }
		const properties: any[] = ((type === 'fs') ?
			[ 'openDirectory' ] : [ 'openFile' ]);
		if (multiSelections) {
			properties.push('multiSelections');
		}
		properties.push('createDirectory');
		this.win.focus();
		return dialog.showOpenDialog(
			this.win,
			{ title, buttonLabel, filters, properties });
	}

	async saveFileDialog(
		title: string, buttonLabel: string, defaultPath: string,
		filters?: FileTypeFilter[]
	): Promise<WritableFile|undefined> {
		const res = await this.savingDialog(
			title, buttonLabel, defaultPath, filters);
		if (res.canceled || !res.filePath) { return; }
		const path = res.filePath;
		const exists = !!(await fsStat(path).catch((exc: FileException) => {
			if (exc.notFound) { return; }
			else { throw exc; }
		}));
		return (await makeFileFor(path, exists, true)) as WritableFile;
	}

	async saveFolderDialog(
		title: string, buttonLabel: string, defaultPath: string,
		filters?: FileTypeFilter[]
	): Promise<WritableFS|undefined> {
		const res = await this.savingDialog(
			title, buttonLabel, defaultPath, filters);
		if (res.canceled || !res.filePath) { return; }
		const path = res.filePath;
		const exists = !!(await fsStat(path).catch((exc: FileException) => {
			if (exc.notFound) { return; }
			else { throw exc; }
		}));
		return (await makeFolderFor(path, exists, true)) as WritableFS;
	}

	private savingDialog(
		title: string, buttonLabel: string, defaultPath: string,
		filters?: FileTypeFilter[]
	): Promise<Electron.SaveDialogReturnValue> {
		if (!this.win || this.win.isDestroyed()) { throw new Error(
			`Parent window is either not set, or is already gone`); }
		this.win.focus();
		return dialog.showSaveDialog(
			this.win,
			{ title, buttonLabel, defaultPath, filters });
	}

	getDevFS(
		path: string, writable = false, create = false, exclusive = false
	): Promise<WritableFS|ReadonlyFS> {
		if (writable) {
			return DeviceFS.makeWritable(path, create, exclusive);
		} else {
			return DeviceFS.makeReadonly(path);
		}
	}

	async getDevFile(
		path: string, writable = false, create = false, exclusive = false
	): Promise<WritableFile|ReadonlyFile> {
		const fName = basename(path);
		const folder = dirname(path);
		const fs = await DeviceFS.makeWritable(folder);
		if (writable) {
			return fs.writableFile(fName, { create, exclusive });
		} else {
			return fs.readonlyFile(fName);
		}
	}

}

async function makeFileFor(
	path: string, exists: boolean, isWritable: boolean
): Promise<ReadonlyFile|WritableFile> {
	const fName = basename(path);
	const folder = dirname(path);
	const fs = await DeviceFS.makeWritable(folder);
	if (isWritable) {
		return fs.writableFile(fName, { create:!exists, exclusive:!exists });
	} else {
		return fs.readonlyFile(fName);
	}
} 

async function makeFolderFor(
	path: string, exists: boolean, isWritable: boolean
): Promise<ReadonlyFS|WritableFS> {
	const fName = basename(path);
	const folder = dirname(path);
	const fs = await DeviceFS.makeWritable(folder);
	if (isWritable) {
		return fs.writableSubRoot(fName, { create:!exists, exclusive:!exists });
	} else {
		return fs.readonlySubRoot(fName);
	}
} 

Object.freeze(exports);