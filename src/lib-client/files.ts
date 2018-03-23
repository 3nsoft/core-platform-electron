/*
 Copyright (C) 2016 - 2018 3NSoft Inc.

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

import { bind } from '../lib-common/binding';
import { makeFileException, Code as excCode }
	from '../lib-common/exceptions/file';
import { pipe } from '../lib-common/byte-streaming/pipe';
import { utf8 } from '../lib-common/buffer-utils';

type FS = web3n.files.FS;
type ReadonlyFS = web3n.files.ReadonlyFS;
type WritableFS = web3n.files.WritableFS;
type File = web3n.files.File;
type ReadonlyFile = web3n.files.ReadonlyFile;
type WritableFile = web3n.files.WritableFile;
type ListingEntry = web3n.files.ListingEntry;
type SymLink = web3n.files.SymLink;
type ByteSink = web3n.ByteSink;
type ByteSource = web3n.ByteSource;
type FSType = web3n.files.FSType;

export interface LinkParameters<T> {
	storageType: FSType;
	readonly?: boolean;
	isFolder?: boolean;
	isFile?: boolean;
	params: T;
}

/**
 * This interface is applicable to core-side FS and File objects.
 * NOTICE: when renaming this function, ensure renaming in excluded fields,
 * in wrapping for UI app functionality, used in a preload script portion.
 * Raw string is used there, and automagic renaming will not work there.
 */
export interface Linkable {
	getLinkParams(): Promise<LinkParameters<any>>;
}

type Transferable = web3n.implementation.Transferable;

export function wrapFileImplementation(fImpl: File): File {
	return (fImpl.writable ?
			wrapWritableFile(fImpl as WritableFile) :
			wrapReadonlyFile(fImpl as ReadonlyFile));
}

export function wrapWritableFile(fImpl: WritableFile): WritableFile {
	ensureWritable(fImpl);
	const w: WritableFile = {
		v: wrapWritableFileVersionedAPI(fImpl.v),
		writable: fImpl.writable,
		isNew: fImpl.isNew,
		name: fImpl.name,
		getByteSource: bind(fImpl, fImpl.getByteSource),
		readJSON: bind(fImpl, fImpl.readJSON),
		readTxt: bind(fImpl, fImpl.readTxt),
		readBytes: bind(fImpl, fImpl.readBytes),
		stat: bind(fImpl, fImpl.stat),
		getByteSink: bind(fImpl, fImpl.getByteSink),
		writeJSON: bind(fImpl, fImpl.writeJSON),
		writeTxt: bind(fImpl, fImpl.writeTxt),
		writeBytes: bind(fImpl, fImpl.writeBytes),
		copy: bind(fImpl, fImpl.copy),
	};
	return addParamsAndFreezeFileWrap(w, fImpl);
}

function ensureWritable(o: { writable: boolean }): void {
	if (!o.writable) {
		throw Error(`File/FS object with unexpected flags is given`);
	}
}

type WritableFileVersionedAPI = web3n.files.WritableFileVersionedAPI;

function wrapWritableFileVersionedAPI(
		vImpl: WritableFileVersionedAPI|undefined):
		WritableFileVersionedAPI|undefined {
	if (!vImpl) { return; }
	const w: WritableFileVersionedAPI = {
		copy: bind(vImpl, vImpl.copy),
		getByteSink: bind(vImpl, vImpl.getByteSink),
		getByteSource: bind(vImpl, vImpl.getByteSource),
		readBytes: bind(vImpl, vImpl.readBytes),
		readJSON: bind(vImpl, vImpl.readJSON),
		readTxt: bind(vImpl, vImpl.readTxt),
		writeBytes: bind(vImpl, vImpl.writeBytes),
		writeJSON: bind(vImpl, vImpl.writeJSON),
		writeTxt: bind(vImpl, vImpl.writeTxt)
	};
	return Object.freeze(w);
}

function addParamsAndFreezeFileWrap<T extends ReadonlyFile>(w: T, fImpl: T): T {
	(w as any as Linkable).getLinkParams =
		bind(fImpl, (fImpl as any as Linkable).getLinkParams);
	(w as any as Transferable).$_transferrable_type_id_$ = 'File';
	return Object.freeze(w);
}

export function wrapReadonlyFile(fImpl: ReadonlyFile): ReadonlyFile {
	const w: ReadonlyFile = {
		v: wrapReadonlyFileVersionedAPI(fImpl.v),
		writable: false,
		isNew: fImpl.isNew,
		name: fImpl.name,
		getByteSource: bind(fImpl, fImpl.getByteSource),
		readJSON: bind(fImpl, fImpl.readJSON),
		readTxt: bind(fImpl, fImpl.readTxt),
		readBytes: bind(fImpl, fImpl.readBytes),
		stat: bind(fImpl, fImpl.stat),
	};
	return addParamsAndFreezeFileWrap(w, fImpl);
}

type ReadonlyFileVersionedAPI = web3n.files.ReadonlyFileVersionedAPI;

function wrapReadonlyFileVersionedAPI(
		vImpl: ReadonlyFileVersionedAPI|undefined):
		ReadonlyFileVersionedAPI|undefined {
	if (!vImpl) { return; }
	const w: ReadonlyFileVersionedAPI = {
		getByteSource: bind(vImpl, vImpl.getByteSource),
		readBytes: bind(vImpl, vImpl.readBytes),
		readJSON: bind(vImpl, vImpl.readJSON),
		readTxt: bind(vImpl, vImpl.readTxt)
	};
	return Object.freeze(w);
}

export function wrapFSImplementation(fsImpl: FS): FS {
	return (fsImpl.writable ?
			wrapWritableFS(fsImpl as WritableFS) :
			wrapReadonlyFS(fsImpl as ReadonlyFS));
}

export function wrapWritableFS(fsImpl: WritableFS): WritableFS {
	ensureWritable(fsImpl);
	const w: WritableFS = {
		type: fsImpl.type,
		writable: fsImpl.writable,
		v: wrapWritableFSVersionedAPI(fsImpl.v),
		name: fsImpl.name,
		getByteSource: bind(fsImpl, fsImpl.getByteSource),
		readBytes: bind(fsImpl, fsImpl.readBytes),
		readTxtFile: bind(fsImpl, fsImpl.readTxtFile),
		readJSONFile: bind(fsImpl, fsImpl.readJSONFile),
		listFolder: bind(fsImpl, fsImpl.listFolder),
		checkFolderPresence: bind(fsImpl, fsImpl.checkFolderPresence),
		checkFilePresence: bind(fsImpl, fsImpl.checkFilePresence),
		statFile: bind(fsImpl, fsImpl.statFile),
		readonlyFile: bind(fsImpl, fsImpl.readonlyFile),
		readonlySubRoot: bind(fsImpl, fsImpl.readonlySubRoot),
		close: bind(fsImpl, fsImpl.close),
		checkLinkPresence: bind(fsImpl, fsImpl.checkLinkPresence),
		readLink: bind(fsImpl, fsImpl.readLink),
		getByteSink: bind(fsImpl, fsImpl.getByteSink),
		writeBytes: bind(fsImpl, fsImpl.writeBytes),
		writeTxtFile: bind(fsImpl, fsImpl.writeTxtFile),
		writeJSONFile: bind(fsImpl, fsImpl.writeJSONFile),
		makeFolder: bind(fsImpl, fsImpl.makeFolder),
		deleteFile: bind(fsImpl, fsImpl.deleteFile),
		deleteFolder: bind(fsImpl, fsImpl.deleteFolder),
		move: bind(fsImpl, fsImpl.move),
		copyFile: bind(fsImpl, fsImpl.copyFile),
		copyFolder: bind(fsImpl, fsImpl.copyFolder),
		writableFile: bind(fsImpl, fsImpl.writableFile),
		writableSubRoot: bind(fsImpl, fsImpl.writableSubRoot),
		saveFile: bind(fsImpl, fsImpl.saveFile),
		saveFolder: bind(fsImpl, fsImpl.saveFolder),
		link: bind(fsImpl, fsImpl.link),
		deleteLink: bind(fsImpl, fsImpl.deleteLink),
		watchFolder: bind(fsImpl, fsImpl.watchFolder),
		watchFile: bind(fsImpl, fsImpl.watchFile),
		watchTree: bind(fsImpl, fsImpl.watchTree),
		select: bind(fsImpl, fsImpl.select),
	};
	return addParamsAndFreezeFSWrap(w, fsImpl);
}

function addParamsAndFreezeFSWrap<T extends ReadonlyFS>(w: T, fsImpl: T): T {
	if ((fsImpl as any as Linkable).getLinkParams) {
		(w as any as Linkable).getLinkParams =
			bind(fsImpl, (fsImpl as any as Linkable).getLinkParams);
	}
	(w as any as Transferable).$_transferrable_type_id_$ = 'FS';
	return Object.freeze(w);
}

type WritableFSVersionedAPI = web3n.files.WritableFSVersionedAPI;

function wrapWritableFSVersionedAPI(vImpl: WritableFSVersionedAPI|undefined):
		WritableFSVersionedAPI|undefined {
	if (!vImpl) { return; }
	const w: WritableFSVersionedAPI = {
		getByteSink: bind(vImpl, vImpl.getByteSink),
		getByteSource: bind(vImpl, vImpl.getByteSource),
		readBytes: bind(vImpl, vImpl.readBytes),
		writeBytes: bind(vImpl, vImpl.writeBytes),
		listFolder: bind(vImpl, vImpl.listFolder),
		readJSONFile: bind(vImpl, vImpl.readJSONFile),
		readTxtFile: bind(vImpl, vImpl.readTxtFile),
		writeJSONFile: bind(vImpl, vImpl.writeJSONFile),
		writeTxtFile: bind(vImpl, vImpl.writeTxtFile),
	};
	return Object.freeze(w);
}

export function wrapReadonlyFS(fsImpl: ReadonlyFS): ReadonlyFS {
	const w: ReadonlyFS = {
		type: fsImpl.type,
		writable: false,
		v: wrapReadonlyFSVersionedAPI(fsImpl.v),
		name: fsImpl.name,
		getByteSource: bind(fsImpl, fsImpl.getByteSource),
		readBytes: bind(fsImpl, fsImpl.readBytes),
		readTxtFile: bind(fsImpl, fsImpl.readTxtFile),
		readJSONFile: bind(fsImpl, fsImpl.readJSONFile),
		listFolder: bind(fsImpl, fsImpl.listFolder),
		checkFolderPresence: bind(fsImpl, fsImpl.checkFolderPresence),
		checkFilePresence: bind(fsImpl, fsImpl.checkFilePresence),
		statFile: bind(fsImpl, fsImpl.statFile),
		readonlyFile: bind(fsImpl, fsImpl.readonlyFile),
		readonlySubRoot: bind(fsImpl, fsImpl.readonlySubRoot),
		close: bind(fsImpl, fsImpl.close),
		checkLinkPresence: bind(fsImpl, fsImpl.checkLinkPresence),
		readLink: bind(fsImpl, fsImpl.readLink),
		watchFolder: bind(fsImpl, fsImpl.watchFolder),
		watchFile: bind(fsImpl, fsImpl.watchFile),
		watchTree: bind(fsImpl, fsImpl.watchTree),
		select: bind(fsImpl, fsImpl.select),
	};
	return addParamsAndFreezeFSWrap(w, fsImpl);
}

type ReadonlyFSVersionedAPI = web3n.files.ReadonlyFSVersionedAPI;

function wrapReadonlyFSVersionedAPI(vImpl: ReadonlyFSVersionedAPI|undefined):
		ReadonlyFSVersionedAPI|undefined {
	if (!vImpl) { return; }
	const w: ReadonlyFSVersionedAPI = {
		getByteSource: bind(vImpl, vImpl.getByteSource),
		readBytes: bind(vImpl, vImpl.readBytes),
		listFolder: bind(vImpl, vImpl.listFolder),
		readJSONFile: bind(vImpl, vImpl.readJSONFile),
		readTxtFile: bind(vImpl, vImpl.readTxtFile)
	};
	return Object.freeze(w);
}

/**
 * This wraps given versioned fs into readonly versionless fs that will fail to
 * be linked. So, use this function for non linkable storages like asmail-msg.
 * @param fs to wrap
 */
export function wrapIntoVersionlessReadonlyFS(fs: ReadonlyFS,
		type?: FSType): ReadonlyFS {
	const w: ReadonlyFS = {
		name: fs.name,
		v: undefined,
		writable: false,
		type: (type ? type : fs.type),
		getByteSource: bind(fs, fs.getByteSource),
		readBytes: bind(fs, fs.readBytes),
		readTxtFile: bind(fs, fs.readTxtFile),
		readJSONFile: bind(fs, fs.readJSONFile),
		listFolder: bind(fs, fs.listFolder),
		checkFolderPresence: bind(fs, fs.checkFolderPresence),
		checkFilePresence: bind(fs, fs.checkFilePresence),
		statFile: async (path: string) => {
			const stats = await fs.statFile(path);
			delete stats.version;
			return stats;
		},
		readonlyFile: async (path: string) => toVersionlessReadonlyFile(
			await fs.readonlyFile(path)),
		readonlySubRoot: async (path: string) => wrapIntoVersionlessReadonlyFS(
			await fs.readonlySubRoot(path)),
		close: bind(fs, fs.close),
		checkLinkPresence: bind(fs, fs.checkLinkPresence),
		readLink: bind(fs, fs.readLink),
		watchFolder: bind(fs, fs.watchFolder),
		watchFile: bind(fs, fs.watchFile),
		watchTree: bind(fs, fs.watchTree),
		select: bind(fs, fs.select),
	};
	(w as any as Transferable).$_transferrable_type_id_$ = 'FS';
	return Object.freeze(w);
}

/**
 * This wraps given versioned file into readonly versionless file that will fail
 * to be linked. So, use this function for non linkable storages like
 * asmail-msg.
 * @param f 
 */
function toVersionlessReadonlyFile(f: ReadonlyFile): ReadonlyFile {
	const w: ReadonlyFile = {
		isNew: f.isNew,
		name: f.name,
		v: undefined,
		writable: false,
		getByteSource: bind(f, f.getByteSource),
		readJSON: bind(f, f.readJSON),
		readTxt: bind(f, f.readTxt),
		readBytes: bind(f, f.readBytes),
		stat: async () => {
			const stats = await f.stat();
			delete stats.version;
			return stats;
		},
	};
	(w as any as Transferable).$_transferrable_type_id_$ = 'File';
	return Object.freeze(w);
}


Object.freeze(exports);