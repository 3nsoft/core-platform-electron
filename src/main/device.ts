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

import { dialog } from 'electron';
import { basename, dirname } from 'path';
import { stat as fsStat } from '../lib-common/async-fs-node';
import { DeviceFS } from '../lib-client/local-files/device-fs';
import { FileException } from '../lib-common/exceptions/file';
import { bind } from '../lib-common/binding';
import { Duplex, RequestEnvelope } from '../lib-common/ipc/electron-ipc';
import { ProxiedObjGetter } from './proxied-objs/fs';
import { device, FileDetails } from '../renderer/common';

function makeFileFor(path: string, exists: boolean, isWritable: boolean):
		Promise<web3n.files.File> {
	let fName = basename(path);
	let folder = dirname(path);
	let fs = new DeviceFS(folder, true);
	if (isWritable) {
		return fs.writableFile(fName, !exists, !exists);
	} else {
		return fs.readonlyFile(fName);
	}
} 

async function openFileDialog(title: string, buttonLabel: string,
		multiSelections: boolean, filters?: web3n.device.files.FileTypeFilter[]):
		Promise<web3n.files.File[] | undefined> {
	let properties: any[] = [ 'openFile' ];
	if (multiSelections) {
		properties.push('multiSelections');
	}
	let paths = await new Promise<string[]>((resolve) => {
		dialog.showOpenDialog(
			{ title, buttonLabel, filters, properties },
			resolve);
	});
	if (!Array.isArray(paths) || (paths.length === 0)) { return; }
	let files: web3n.files.File[] = [];
	for (let path of paths) {
		files.push(await makeFileFor(path, true, false));
	}
	return files;
}

async function saveFileDialog(title: string, buttonLabel: string,
		defaultPath: string, filters?: web3n.device.files.FileTypeFilter[]):
		Promise<web3n.files.File | undefined> {
	let path = await new Promise<string>((resolve) => {
		dialog.showSaveDialog(
			{ title, buttonLabel, defaultPath, filters },
			resolve);
	});
	if (!path) { return; }
	let exists = !!(await fsStat(path).catch((exc: FileException) => {
		if (exc.notFound) { return; }
		else { throw exc; }
	}));
	return makeFileFor(path, exists, true);
}

export class Device {
	
	private uiSide: Duplex = (undefined as any);
	private proxiedObjs: ProxiedObjGetter = (undefined as any);
	
	constructor() {
		Object.seal(this);
	}
	
	attachTo(uiSide: Duplex, proxiedObjs: ProxiedObjGetter): void {
		this.uiSide = uiSide;
		this.proxiedObjs = proxiedObjs;
		this.attachHandlersToUI();
	}
	
	private attachHandlersToUI(): void {
		let uiReqNames = device.uiReqNames.files;
		this.uiSide.addHandler(uiReqNames.openFileDialog,
			bind(this, this.handleOpenFileDialog));
		this.uiSide.addHandler(uiReqNames.saveFileDialog,
			bind(this, this.handleSaveFileDialog));
	}
	
	private async handleOpenFileDialog(
			env: RequestEnvelope<device.OpenFileDialogRequest>):
			Promise<FileDetails[]|undefined> {
		let { title, btnLabel, multiSelections, filters } = env.req;
		let files = await openFileDialog(
			title, btnLabel, multiSelections, filters);
		if (!files) { return; }
		let fInfos: FileDetails[] = [];
		for (let file of files) {
			let fInfo = this.proxiedObjs.addFile(file as web3n.storage.File);
			fInfos.push(fInfo);
		}
		return fInfos;
	}
	
	private async handleSaveFileDialog(
			env: RequestEnvelope<device.SaveFileDialogRequest>):
			Promise<FileDetails|undefined> {
		let { title, btnLabel, defaultPath, filters } = env.req;
		let file = await saveFileDialog(
			title, btnLabel, defaultPath, filters);
		if (!file) { return; }
		let fInfo = this.proxiedObjs.addFile(file as web3n.storage.File);
		return fInfo;
	}

}
Object.freeze(Device.prototype);
Object.freeze(Device);

Object.freeze(exports);