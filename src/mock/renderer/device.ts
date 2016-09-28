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

import { remote } from 'electron';
import { basename, dirname } from 'path';
import { stat as fsStat } from '../../lib-common/async-fs-node';
import { DeviceFS } from '../../lib-client/local-files/device-fs';
import { ByteSink, ByteSource } from '../../lib-common/byte-streaming/common';
import { syncWrapByteSink, syncWrapByteSource }
	from '../../lib-common/byte-streaming/concurrent';
import { maskPathInExc, FileException } from '../../lib-common/exceptions/file';
import { bind } from '../../lib-common/binding';

const dialog = remote.dialog;

function makeFileFor(path: string, exists: boolean, isWritable: boolean):
		Promise<Web3N.Files.File> {
	let fName = basename(path);
	let folder = dirname(path);
	let fs = new DeviceFS(folder);
	if (isWritable) {
		return fs.writableFile(fName, !exists, !exists);
	} else {
		return fs.readonlyFile(fName);
	}
} 

export async function openFileDialog(title: string, buttonLabel: string,
		multiSelections: boolean, filters?: Web3N.Device.Files.FileTypeFilter[]):
		Promise<Web3N.Files.File[]> {
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
	let files: Web3N.Files.File[] = [];
	for (let path of paths) {
		files.push(await makeFileFor(path, true, false));
	}
	return files;
}

export async function saveFileDialog(title: string, buttonLabel: string,
		defaultPath: string, filters?: Web3N.Device.Files.FileTypeFilter[]):
		Promise<Web3N.Files.File> {
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