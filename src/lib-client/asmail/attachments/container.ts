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

import { bind } from '../../../lib-common/binding';

type FS = web3n.storage.FS;
type File = web3n.storage.File;
type AttachmentsContainer = web3n.asmail.AttachmentsContainer;

export class Container implements AttachmentsContainer {

	private folders = new Map<string, FS>();
	private files = new Map<string, File>();

	addFile(file: File, newName?: string): void {
		let name = (newName ? newName : file.name);
		if (this.files.has(name) || this.folders.has(name)) { throw new Error(
			`Name ${name} is already used by another attachment`); }
		this.files.set(name, file);
	}

	addFolder(fs: FS, newName?: string): void {
		let name = (newName ? newName : fs.name);
		if (this.files.has(name) || this.folders.has(name)) { throw new Error(
			`Name ${name} is already used by another attachment`); }
		this.folders.set(name, fs);
	}

	rename(initName: string, newName: string): void {
		let f = this.files.get(initName);
		if (f) { throw new Error(`Unkown entity with name ${initName}`); }
		if (initName === newName) { return; }
		if (this.files.has(newName)) { throw new Error(
			`Name ${newName} is already used by another attachment`); }
		this.files.set(newName, f);
		this.files.delete(initName);
	}

	getAllFiles(): Map<string, File> {
		return this.files;
	}

	getAllFolders(): Map<string, FS> {
		return this.folders;
	}

	wrap(): AttachmentsContainer {
		let w: AttachmentsContainer = {
			addFile: bind(this, this.addFile),
			addFolder: bind(this, this.addFolder),
			rename: bind(this, this.rename),
			getAllFiles: bind(this, this.getAllFiles),
			getAllFolders: bind(this, this.getAllFolders)
		};
		Object.freeze(w);
		return w;
	}

}
Object.freeze(Container.prototype);
Object.freeze(Container);

Object.freeze(exports);