/*
 Copyright (C) 2016 - 2017 3NSoft Inc.

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

import { dialog } from 'electron';
import { basename, dirname } from 'path';
import { stat as fsStat } from '../lib-common/async-fs-node';
import { DeviceFS } from '../lib-client/local-files/device-fs';
import { FileException } from '../lib-common/exceptions/file';
import { bind } from '../lib-common/binding';
import { AppInstance } from '../ui/app-instance';

export interface Device {
	openFileDialog: web3n.device.files.OpenFileDialog;
	openFolderDialog: web3n.device.files.OpenFolderDialog;
	saveFileDialog: web3n.device.files.SaveFileDialog;
	saveFolderDialog: web3n.device.files.SaveFolderDialog;
}

export interface DeviceFileOpener {
	remotedCAP: Device;
	setAppInstance(app: AppInstance): void;
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
		const remotedCAP: Device = {
			openFileDialog: bind(this, this.openFileDialog),
			openFolderDialog: bind(this, this.openFolderDialog),
			saveFileDialog: bind(this, this.saveFileDialog),
			saveFolderDialog: bind(this, this.saveFolderDialog),
		};
		Object.freeze(remotedCAP);
		
		const w: DeviceFileOpener = {
			setAppInstance: bind(this, this.setAppInstance),
			close: (): void => {
				this.win = undefined;
			},
			remotedCAP
		};
		return Object.freeze(w);
	}

	private setAppInstance(app: AppInstance): void {
		if (this.win) { throw new Error(`Window instance is already set`); }
		this.win = app.window;
	}

	async openFileDialog(title: string, buttonLabel: string,
			multiSelections: boolean, filters?: FileTypeFilter[]):
			Promise<ReadonlyFile[]|undefined> {
		const paths = await this.openningDialog('file',
			title, buttonLabel, multiSelections, filters);
		if (!paths) { return; }
		const files: ReadonlyFile[] = [];
		for (const path of paths) {
			files.push(await makeFileFor(path, true, false));
		}
		return files;
	}

	async openFolderDialog(title: string, buttonLabel: string,
			multiSelections: boolean, filters?: FileTypeFilter[]):
			Promise<WritableFS[]|undefined> {
		const paths = await this.openningDialog('fs',
			title, buttonLabel, multiSelections, filters);
		if (!paths) { return; }
		const folders: WritableFS[] = [];
		for (const path of paths) {
			folders.push(await makeFolderFor(path, true, true) as WritableFS);
		}
		return folders;
	}

	private async openningDialog(type: 'file'|'fs', title: string,
			buttonLabel: string, multiSelections: boolean,
			filters?: FileTypeFilter[]): Promise<string[]|undefined> {
		const properties: any[] = ((type === 'fs') ?
			[ 'openDirectory' ] : [ 'openFile' ]);
		if (multiSelections) {
			properties.push('multiSelections');
		}
		properties.push('createDirectory');
		const paths = await new Promise<string[]>(resolve => {
			if (!this.win || this.win.isDestroyed()) { throw new Error(
				`Parent window is either not set, or is already gone`); }
			this.win.focus();
			dialog.showOpenDialog(
				this.win,
				{ title, buttonLabel, filters, properties },
				resolve);
		});
		if (!Array.isArray(paths) || (paths.length === 0)) { return; }
		return paths;
	}

	async saveFileDialog(title: string, buttonLabel: string,
			defaultPath: string, filters?: FileTypeFilter[]):
			Promise<WritableFile|undefined> {
		const path = await this.savingDialog(
			title, buttonLabel, defaultPath, filters);
		if (!path) { return; }
		const exists = !!(await fsStat(path).catch((exc: FileException) => {
			if (exc.notFound) { return; }
			else { throw exc; }
		}));
		return (await makeFileFor(path, exists, true)) as WritableFile;
	}

	async saveFolderDialog(title: string, buttonLabel: string,
			defaultPath: string, filters?: FileTypeFilter[]):
			Promise<WritableFS|undefined> {
		const path = await this.savingDialog(
			title, buttonLabel, defaultPath, filters);
		if (!path) { return; }
		const exists = !!(await fsStat(path).catch((exc: FileException) => {
			if (exc.notFound) { return; }
			else { throw exc; }
		}));
		return (await makeFolderFor(path, exists, true)) as WritableFS;
	}

	private savingDialog(title: string, buttonLabel: string, defaultPath: string,
			filters?: FileTypeFilter[]): Promise<string|undefined> {
		return new Promise<string|undefined>(resolve => {
			if (!this.win || this.win.isDestroyed()) { throw new Error(
				`Parent window is either not set, or is already gone`); }
			this.win.focus();
			dialog.showSaveDialog(
				this.win,
				{ title, buttonLabel, defaultPath, filters },
				resolve);
		});
	}

	getDevFS(path: string, writable = false, create = false,
			exclusive = false): Promise<WritableFS|ReadonlyFS> {
		if (writable) {
			return DeviceFS.makeWritable(path, create, exclusive);
		} else {
			return DeviceFS.makeReadonly(path);
		}
	}

	async getDevFile(path: string, writable = false, create = false,
			exclusive = false): Promise<WritableFile|ReadonlyFile> {
		const fName = basename(path);
		const folder = dirname(path);
		const fs = await DeviceFS.makeWritable(folder);
		if (writable) {
			return fs.writableFile(fName, create, exclusive);
		} else {
			return fs.readonlyFile(fName);
		}
	}

}

async function makeFileFor(path: string, exists: boolean, isWritable: boolean):
		Promise<ReadonlyFile|WritableFile> {
	const fName = basename(path);
	const folder = dirname(path);
	const fs = await DeviceFS.makeWritable(folder);
	if (isWritable) {
		return fs.writableFile(fName, !exists, !exists);
	} else {
		return fs.readonlyFile(fName);
	}
} 

async function makeFolderFor(path: string, exists: boolean,
		isWritable: boolean): Promise<ReadonlyFS|WritableFS> {
	const fName = basename(path);
	const folder = dirname(path);
	const fs = await DeviceFS.makeWritable(folder);
	if (isWritable) {
		return fs.writableSubRoot(fName, !exists, !exists);
	} else {
		return fs.readonlySubRoot(fName);
	}
} 

Object.freeze(exports);