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

/**
 * This module provides app-files functionality, acting as a front side for
 * app-files reliance set.
 */

import { DeviceFS } from '../lib-client/local-files/device-fs';
import { stat, mkdir } from '../lib-common/async-fs-node';
import { utf8, base64urlSafe } from '../lib-common/buffer-utils';
import { toCanonicalAddress } from '../lib-common/canonical-address';
import { FileException } from '../lib-common/exceptions/file';
import { errWithCause } from '../lib-common/exceptions/error';
import { NamedProcs } from '../lib-common/processes';
import { wrapReadonlyFile, wrapReadonlyFS, wrapWritableFile, wrapWritableFS,
	Linkable }
	from '../lib-client/files';
import * as pathMod from 'path';
import { getDataArgFrom } from '../lib-client/local-files/app-files';

function userIdToFolderName(userId: string): string {
	userId = toCanonicalAddress(userId);
	return base64urlSafe.pack(utf8.pack(userId));
}

const APP_DIR = (() => {
	// either get value from parameters
	const dataDir = getDataArgFrom(process.argv);
	return (dataDir ? dataDir : '3NWeb-mock');
})();
const INBOX_DIR = 'inbox';
const STORAGE_DIR = 'storage';

const LOCAL_STORAGE_DIR = 'local';
const SYNCED_STORAGE_DIR = 'synced';

type ReadonlyFS = web3n.files.ReadonlyFS;
type WritableFS = web3n.files.WritableFS;
type FSType = web3n.files.FSType;

async function appFS(versioned: boolean, type: FSType): Promise<WritableFS|ReadonlyFS> {
	await stat(APP_DIR).catch(async (e: FileException) => {
		if (!e.notFound) { throw e; }
		await mkdir(APP_DIR).catch((e: FileException) => {
			if (e.alreadyExists) { return; }
			throw errWithCause(e, `Cannot create app folder on the disk`);
		});
	});
	const nonVersioned = await DeviceFS.makeWritableFS(APP_DIR);
	return (versioned ?
		mockVersionedFS(nonVersioned, true, type) :
		nonVersioned);
}

async function getInUserVersionedFS(user: string, path: string, type: FSType):
		Promise<WritableFS> {
	return (await appFS(true, type) as WritableFS).writableSubRoot(
		userIdToFolderName(user)+'/'+path);
}

async function getInUserFS(user: string, path: string, type: FSType):
		Promise<WritableFS> {
	return ((await appFS(false, type)) as WritableFS).writableSubRoot(
		userIdToFolderName(user)+'/'+path);
}

export function makeStorageFS(user: string, type: 'local' | 'synced'):
		Promise<WritableFS> {
	let folder: string;
	if (type === 'local') {
		folder = `${STORAGE_DIR}/${LOCAL_STORAGE_DIR}`;
	} else if (type === 'synced') {
		folder = `${STORAGE_DIR}/${SYNCED_STORAGE_DIR}`;
	} else {
		throw new Error(`Cannot mock storage type ${type}`);
	}
	return getInUserVersionedFS(user, folder, type);
}

export function makeInboxFS(user: string): Promise<WritableFS> {
	return getInUserFS(user, INBOX_DIR, 'asmail-msg');
}

const mockInfoFile = '.$mock-fs-folder-info$';

interface MockFolderInfo {
	version: number;
	files: { [name: string]: number };
	links: { [name: string]: FSType };
}

function infoFromFilePath(path: string) {
	const parentFolder = pathMod.dirname(path);
	return {
		parentFolder,
		fileName: pathMod.basename(path),
		infoFile: `${parentFolder}/${mockInfoFile}`
	};
}

async function getFileVersion(devFS: WritableFS, path: string):
		Promise<number> {
	const { fileName, infoFile } = infoFromFilePath(path);
	try {
		const info = await devFS.readJSONFile<MockFolderInfo>(infoFile);
		const version = info.files[fileName];
		return ((typeof version === 'number') ? version : 1);
	} catch (err) {
		if ((err as FileException).notFound) { return 1; }
		throw errWithCause(err,`Error occured in mocking versioned fs on top of device fs`);
	}
}
	
async function getFolderVersion(devFS: WritableFS, folder: string):
		Promise<number> {
	const infoFile = `${folder}/${mockInfoFile}`;
	try {
		return (await devFS.readJSONFile<MockFolderInfo>(infoFile)).version;
	} catch (err) {
		if ((err as FileException).notFound) { return 1; }
		throw errWithCause(err,`Error occured in mocking versioned fs on top of device fs`);
	}
}

async function upFileVersion(devFS: WritableFS, path: string):
		Promise<number> {
	const { fileName, infoFile, parentFolder} = infoFromFilePath(path);
	try {
		const info = await devFS.readJSONFile<MockFolderInfo>(infoFile);
		let version = info.files[fileName];
		version = ((typeof version === 'number') ? version+1 : 1);
		info.files[fileName] = version;
		await devFS.writeJSONFile(infoFile, info, false);
		return version;
	} catch (err) {
		if ((err as FileException).notFound) {
			await makeNewInfoFile(devFS, parentFolder);
			return upFileVersion(devFS, path);
		}
		throw errWithCause(err,`Error occured in mocking versioned fs on top of device fs, when increasing version for file ${fileName} in folder ${parentFolder}`);
	}
}

async function makeNewInfoFile(devFS: WritableFS, folder: string):
		Promise<void> {
	const infoFile = `${folder}/${mockInfoFile}`;
	try {
		await devFS.checkFolderPresence(folder, true);
		const info: MockFolderInfo = {
			version: 1,
			files: {},
			links: {}
		};
		await devFS.writeJSONFile(infoFile, info, true, true);
	} catch (err) {
		if ((err as FileException).alreadyExists) { return; }
		throw errWithCause(err,`Error occured in mocking versioned fs on top of device fs, when generating ${mockInfoFile} file in folder ${folder}`);
	}
}

async function upFolderVersion(devFS: WritableFS, folder: string):
		Promise<number> {
	const infoFile = `${folder}/${mockInfoFile}`;
	try {
		const info = await devFS.readJSONFile<MockFolderInfo>(infoFile);
		info.version += 1;
		await devFS.writeJSONFile(infoFile, info, false);
		return info.version;
	} catch (err) {
		if ((err as FileException).notFound) {
			await makeNewInfoFile(devFS, folder);
			return 1;
		}
		throw errWithCause(err,`Error occured in mocking versioned fs on top of device fs, when increasing version for folder ${folder}`);
	}
}

async function addFileVersion(devFS: WritableFS, path: string, version = 1):
		Promise<void> {
	const { fileName, infoFile, parentFolder} = infoFromFilePath(path);
	try {
		const info = await devFS.readJSONFile<MockFolderInfo>(infoFile);
		info.files[fileName] = version;
		await devFS.writeJSONFile(infoFile, info, false);
	} catch (err) {
		if ((err as FileException).notFound) {
			await makeNewInfoFile(devFS, parentFolder);
			return addFileVersion(devFS, path, version);
		}
		throw errWithCause(err,`Error occured in mocking versioned fs on top of device fs, when adding file ${fileName} versioning in folder ${parentFolder}`);
	}
}

async function removeFileVersion(devFS: WritableFS, path: string):
		Promise<number|undefined> {
	const { fileName, infoFile, parentFolder} = infoFromFilePath(path);
	try {
		const info = await devFS.readJSONFile<MockFolderInfo>(infoFile);
		if ((typeof info.files[fileName]) !== 'number') { return; }
		const version = info.files[fileName];
		delete info.files[fileName];
		await devFS.writeJSONFile(infoFile, info, false);
		return version;
	} catch (err) {
		if ((err as FileException).notFound) { return; }
		throw errWithCause(err,`Error occured in mocking versioned fs on top of device fs, when removing file ${fileName} versioning in folder ${parentFolder}`);
	}
}

async function addLinkType(devFS: WritableFS, path: string, type: FSType):
		Promise<void> {
	const { fileName, infoFile, parentFolder} = infoFromFilePath(path);
	try {
		const info = await devFS.readJSONFile<MockFolderInfo>(infoFile);
		info.links[fileName] = type;
		await devFS.writeJSONFile(infoFile, info, false);
	} catch (err) {
		if ((err as FileException).notFound) {
			await makeNewInfoFile(devFS, parentFolder);
			return addLinkType(devFS, path, type);
		}
		throw errWithCause(err,`Error occured in mocking versioned fs on top of device fs, when adding link ${fileName} type in folder ${parentFolder}`);
	}
}

async function getLinkType(devFS: WritableFS, path: string): Promise<FSType> {
	const { fileName, infoFile, parentFolder} = infoFromFilePath(path);
	try {
		const info = await devFS.readJSONFile<MockFolderInfo>(infoFile);
		return info.links[fileName];
	} catch (err) {
		throw errWithCause(err,`Error occured in mocking versioned fs on top of device fs, when getting link ${fileName} type in folder ${parentFolder}`);
	}
}

async function removeLinkType(devFS: WritableFS, path: string):
		Promise<void> {
	const { fileName, infoFile, parentFolder} = infoFromFilePath(path);
	try {
		const info = await devFS.readJSONFile<MockFolderInfo>(infoFile);
		if ((typeof info.links[fileName]) !== 'string') { return; }
		delete info.files[fileName];
		await devFS.writeJSONFile(infoFile, info, false);
	} catch (err) {
		if ((err as FileException).notFound) { return; }
		throw errWithCause(err,`Error occured in mocking versioned fs on top of device fs, when removing link ${fileName} type in folder ${parentFolder}`);
	}
}

class Sync {

	private versionUpdateProcs = new NamedProcs();

	constructor(
			private devFS: WritableFS) {
		Object.freeze(this);
	}

	private syncOnFolderVer<T>(folder: string, action: () => Promise<T>):
			Promise<T> {
		const folderName = pathMod.basename(folder);
		return this.versionUpdateProcs.startOrChain(folderName, action);
	}

	private syncOnFileVer<T>(file: string, action: () => Promise<T>):
			Promise<T> {
		const parentFolderName = pathMod.basename(pathMod.dirname(file));
		return this.versionUpdateProcs.startOrChain(parentFolderName, action);
	}

	getFileVer(path: string): Promise<number> {
		return this.syncOnFileVer(path, () => getFileVersion(this.devFS, path));
	}

	upFileVer(path: string): Promise<number> {
		return this.syncOnFileVer(path, () => upFileVersion(this.devFS, path));
	}

	getFolderVer(path: string): Promise<number> {
		return this.syncOnFolderVer(path,
			() => getFolderVersion(this.devFS, path));
	}

	upFolderVer(path: string): Promise<number> {
		return this.syncOnFolderVer(path,
			() => upFolderVersion(this.devFS, path));
	}
	
	addLink(path: string, type: FSType): Promise<void> {
		return this.syncOnFileVer(path,
			() => addLinkType(this.devFS, path, type));
	}
	
	getLinkType(path: string): Promise<FSType> {
		return this.syncOnFileVer(path, () => getLinkType(this.devFS, path));
	}

	rmLink(path: string): Promise<void> {
		return this.syncOnFileVer(path, () => removeLinkType(this.devFS, path));
	}

	rmFile(path: string): Promise<number> {
		return this.syncOnFileVer(path, async () => {
			const lastVersion = await removeFileVersion(this.devFS, path);
			return ((typeof lastVersion === 'number') ? lastVersion : 1);
		});
	}

	addFile(path: string, version = 1): Promise<void> {
		return this.syncOnFileVer(path,
			() => addFileVersion(this.devFS, path, version));
	}

}
Object.freeze(Sync.prototype);
Object.freeze(Sync);

type FS = web3n.files.FS;
type File = web3n.files.File;

function mockVersionedFS(devFS: WritableFS, writable: boolean, type: FSType):
		WritableFS|ReadonlyFS {
	
	const sync = new Sync(devFS);

	const mockV = mockWritableFSVersionedAPI(devFS, sync);

	const mockFS: WritableFS = {
		name: devFS.name,
		type,
		v: mockV,
		writable: true,
		checkFilePresence: devFS.checkFilePresence,
		checkFolderPresence: devFS.checkFolderPresence,
		checkLinkPresence: devFS.checkLinkPresence,
		watchFolder: devFS.watchFolder,
		watchFile: devFS.watchFile,
		watchTree: devFS.watchTree,
		select: devFS.select,

		close: devFS.close,

		copyFile: async (src: string, dst: string, overwrite) => {
			await devFS.copyFile(src, dst, overwrite);
			await sync.upFileVer(dst);
		},

		copyFolder: async (src: string, dst: string, mergeAndOverwrite) => {
			await devFS.copyFolder(src, dst, mergeAndOverwrite);
			await sync.upFolderVer(dst);
		},

		saveFile: async (file, dst: string, overwrite) => {
			await devFS.saveFile(file, dst, overwrite);
			await sync.upFileVer(dst);
		},

		saveFolder: async (folder, dst: string, mergeAndOverwrite) => {
			await devFS.saveFolder(folder, dst, mergeAndOverwrite);
			await sync.upFolderVer(dst);
		},
		
		deleteFile: async (path: string) => {
			await devFS.deleteFile(path);
			await sync.rmFile(path);
		},
		
		deleteLink: async (path: string) => {
			await devFS.deleteLink(path);
			await sync.rmLink(path);
		},

		deleteFolder: async (path: string, removeContent) => {
			await devFS.deleteFolder(path,removeContent);
			await sync.upFolderVer(pathMod.dirname(path));			
		},

		makeFolder: async (path: string, exclusive) => {
			await devFS.makeFolder(path, exclusive);
			await sync.upFolderVer(pathMod.dirname(path));			
		},
		
		move: async (src: string, dst: string) => {
			const isFolder = await devFS.checkFolderPresence(src);
			await devFS.move(src, dst);
			if (isFolder) {
				await sync.upFolderVer(dst);
			} else {
				const fileVer = await sync.rmFile(src);
				sync.addFile(dst, fileVer + 1);
			}
		},

		link: async (path: string, target: File|FS) => {
			await devFS.link(path, target);
			const type: FSType = ((target as FS).type ?
				(target as FS).type :
				((target as File).v ? 'synced' : 'device'));
			await sync.addLink(path, type);
		},

		readLink: async (path: string) => {
			const symLink = await devFS.readLink(path);
			const type = await sync.getLinkType(path);
			if (type === 'device') { return symLink; }
			// note that sync-file object here is not correct for a target, but it
			// will sortof work for file targets, while folders don't use it
			return wrapDeviceSymLink(new SyncFile(sync, path), symLink, type);
		},

		getByteSink: async (path: string, create, exclusive) => {
			const { sink } = await mockV.getByteSink(path, create, exclusive);
			return sink;
		},

		getByteSource: devFS.getByteSource,

		listFolder: devFS.listFolder,

		readBytes: devFS.readBytes,

		readJSONFile: devFS.readJSONFile,

		readTxtFile: devFS.readTxtFile,

		stat: async (path: string) => {
			const st = await devFS.stat(path);
			st.version = await sync.getFileVer(path);
			return st;
		},

		writeBytes: async (path: string, bytes, create, exclusive) => {
			await mockV.writeBytes(path, bytes, create, exclusive);
		},

		writeJSONFile: async (path: string, json, create, exclusive) => {
			await mockV.writeJSONFile(path, json, create, exclusive);
		},
		
		writeTxtFile: async (path: string, txt, create, exclusive) => {
			await mockV.writeTxtFile(path, txt, create, exclusive);
		},
		
		readonlyFile: async (path: string) => {
			const devFile = await devFS.writableFile(path, false);
			return mockVersionedFile(new SyncFile(sync, path), devFile, false) as ReadonlyFile;
		},

		readonlySubRoot: async (path: string) => {
			const devSubRoot = await devFS.writableSubRoot(path, false);
			return mockVersionedFS(devSubRoot, false, type) as ReadonlyFS;
		},

		writableFile: async (path: string, create, exclusive) => {
			const devFile = await devFS.writableFile(path, create, exclusive);
			return mockVersionedFile(new SyncFile(sync, path), devFile, true) as WritableFile;
		},

		writableSubRoot: async (path: string, create, exclusive) => {
			const devSubRoot = await devFS.writableSubRoot(
				path, create, exclusive);
			return mockVersionedFS(devSubRoot, true, type) as WritableFS;
		}
	};

	if ((devFS as any as Linkable).getLinkParams) {
		(mockFS as any as Linkable).getLinkParams =
			(devFS as any as Linkable).getLinkParams;
	}
	
	return (writable ? wrapWritableFS(mockFS) : wrapReadonlyFS(mockFS));
}

type WritableFSVersionedAPI = web3n.files.WritableFSVersionedAPI;

function mockWritableFSVersionedAPI(devFS: WritableFS, sync: Sync):
		WritableFSVersionedAPI {
	const mockV: WritableFSVersionedAPI = {

		getByteSink: async (path: string, create, exclusive) => {
			const sink = await devFS.getByteSink(path, create, exclusive);
			const version = await sync.getFileVer(path);
			return { sink, version };
		},

		getByteSource: async (path: string) => {
			const src = await devFS.getByteSource(path);
			const version = await sync.getFileVer(path);
			return { src, version };
		},

		listFolder: async (path: string) => {
			const lst = (await devFS.listFolder(path))
				.filter(e => (e.name !== mockInfoFile));
			const version = await sync.getFolderVer(path);
			return { lst, version };
		},

		readBytes: async (path: string) => {
			const bytes = await devFS.readBytes(path);
			const version = await sync.getFileVer(path);
			return { bytes, version };
		},

		readJSONFile: async (path: string) => {
			const json = await devFS.readJSONFile<any>(path);
			const version = await sync.getFileVer(path);
			return { json, version };
		},

		readTxtFile: async (path: string) => {
			const txt = await devFS.readTxtFile(path);
			const version = await sync.getFileVer(path);
			return { txt, version };
		},

		writeBytes: async (path: string, bytes, create, exclusive) => {
			await devFS.writeBytes(path, bytes, create, exclusive);
			return await sync.upFileVer(path);
		},

		writeJSONFile: async (path: string, json, create, exclusive) => {
			await devFS.writeJSONFile(path, json, create, exclusive);
			return await sync.upFileVer(path);
		},
		
		writeTxtFile: async (path: string, txt, create, exclusive) => {
			await devFS.writeTxtFile(path, txt, create, exclusive);
			return await sync.upFileVer(path);
		}

	};
	return Object.freeze(mockV);
}

type WritableFile = web3n.files.WritableFile;
type ReadonlyFile = web3n.files.ReadonlyFile;

class SyncFile {

	constructor(
			private sync: Sync,
			private path: string) {
		Object.freeze(this);
	}

	getFileVer(): Promise<number> {
		return this.sync.getFileVer(this.path);
	}

	upFileVer(): Promise<number> {
		return this.sync.upFileVer(this.path);
	}

}
Object.freeze(SyncFile.prototype);
Object.freeze(SyncFile);

function mockVersionedFile(sync: SyncFile, devFile: WritableFile,
		writable: boolean): WritableFile|ReadonlyFile {
	const mockV = mockWritableFileVersionedAPI(sync, devFile);
	const mockFile: WritableFile = {
		name: devFile.name,
		isNew: devFile.isNew,
		v: mockV,
		writable: true,
		
		copy: async (file) => {
			await mockV.copy(file);
		},

		getByteSink: async () => {
			const { sink } = await mockV.getByteSink();
			return sink;
		},

		getByteSource: devFile.getByteSource,

		stat: async () => {
			const st = await devFile.stat();
			st.version = await sync.getFileVer();
			return st;
		},

		writeBytes: async (bytes) => {
			await mockV.writeBytes(bytes);
		},

		writeJSON: async (json) => {
			await mockV.writeJSON(json);
		},
		
		writeTxt: async (txt) => {
			await mockV.writeTxt(txt);
		},

		readBytes: devFile.readBytes,

		readJSON: devFile.readJSON,

		readTxt: devFile.readTxt,

		watch: devFile.watch

	};

	if ((devFile as any as Linkable).getLinkParams) {
		(mockFile as any as Linkable).getLinkParams =
			(devFile as any as Linkable).getLinkParams;
	}

	return (writable ? wrapWritableFile(mockFile) : wrapReadonlyFile(mockFile));
}

type WritableFileVersionedAPI = web3n.files.WritableFileVersionedAPI;

function mockWritableFileVersionedAPI(sync: SyncFile, devFile: WritableFile):
		WritableFileVersionedAPI {
	const mockV: WritableFileVersionedAPI = {
		
		copy: async (file) => {
			await devFile.copy(file);
			return await sync.upFileVer();
		},

		getByteSink: async () => {
			const sink = wrapUnversionedSink(
				await devFile.getByteSink(),
				() => sync.upFileVer())
			const version = (await sync.getFileVer()) + 1;
			return { sink, version };
		},

		getByteSource: async () => {
			const src = await devFile.getByteSource();
			const version = await sync.getFileVer();
			return { src, version };
		},

		writeBytes: async (bytes) => {
			await devFile.writeBytes(bytes);
			return await sync.upFileVer();
		},

		writeJSON: async (json) => {
			await devFile.writeJSON(json);
			return await sync.upFileVer();
		},
		
		writeTxt: async (txt) => {
			await devFile.writeTxt(txt);
			return await sync.upFileVer();
		},

		readBytes: async () => {
			const bytes = await devFile.readBytes();
			const version = await sync.getFileVer();
			return { bytes, version };
		},

		readJSON: async () => {
			const json = await devFile.readJSON<any>();
			const version = await sync.getFileVer();
			return { json, version };
		},

		readTxt: async () => {
			const txt = await devFile.readTxt();
			const version = await sync.getFileVer();
			return { txt, version };
		}

	};
	return Object.freeze(mockV);
}

type ByteSink = web3n.ByteSink;

function wrapUnversionedSink(sink: ByteSink, upFileVer: () => Promise<number>):
		ByteSink {
	const w: ByteSink = {
		getPosition: sink.getPosition,
		getSize: sink.getSize,
		seek: sink.seek,
		setSize: sink.setSize,
		write: async (bytes: Uint8Array|null, err?: any) => {
			await sink.write(bytes, err);
			if (!bytes) {
				await upFileVer();
			}
		}
	};
	return Object.freeze(w);
}

type SymLink = web3n.files.SymLink;
type Transferable = web3n.implementation.Transferable;

function wrapDeviceSymLink(sync: SyncFile, link: SymLink, type: FSType):
		SymLink {
	const w: SymLink = {
		isFile: link.isFile,
		isFolder: link.isFolder,
		readonly: link.readonly,
		target: async () => {
			const devT = await link.target();
			return ((devT as FS).type ?
				mockVersionedFS(devT as WritableFS, !link.readonly, type) :
				mockVersionedFile(sync, devT as WritableFile, !link.readonly));
		}
	};
	(w as any as Transferable).$_transferrable_type_id_$ = 'SimpleObject';
	return Object.freeze(w);
}

Object.freeze(exports);