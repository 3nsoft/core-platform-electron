/*
 Copyright (C) 2015 - 2016 3NSoft Inc.
 
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
import { storage, sinkProxy, sourceProxy, fsProxy, fileProxy, linkProxy,
	FileDetails, FSDetails, SinkDetails, SourceDetails }
	from './common';

export { FSDetails, FileDetails }	from './common';

type FS = web3n.storage.FS;
type File = web3n.storage.File;
type SymLink = web3n.storage.SymLink;
type ByteSource = web3n.ByteSource;
type ByteSink = web3n.ByteSink;

const fsToIdMap = new WeakMap<FS, string>();
const fileToIdMap = new WeakMap<File, string>();

export interface Proxies {
	fsToIdMap: WeakMap<FS, string>;
	fileToIdMap: WeakMap<File, string>;
	getFS: (info: FSDetails) => FS;
	getFile: (info: FileDetails) => File;
}

export function makeStorageOnUISide(core: Duplex):
		{ storage: web3n.storage.Service; proxies: Proxies; } {
	let s = {
		
		async getAppLocalFS(appDomain: string): Promise<FS> {
			let fsId = await core.makeRequest<string>(
				storage.reqNames.openAppLocalFS, appDomain);
			return makeFSView(
				{ fsId, name: appDomain, versioned: true, writable: true },
				core);
		},
		
		async getAppSyncedFS(appDomain: string): Promise<FS> {
			let fsId = await core.makeRequest<string>(
				storage.reqNames.openAppSyncedFS, appDomain);
			return makeFSView(
				{ fsId, name: appDomain, versioned: true, writable: true },
				core);
		}
		
	};
	Object.freeze(s);
	let proxies: Proxies = {
		fsToIdMap,
		fileToIdMap,
		getFS(info: FSDetails): FS {
			return makeFSView(info, core);
		},
		getFile(info: FileDetails): File {
			return makeFileView(info, core);
		}
	};
	Object.freeze(proxies);
	return { storage: s, proxies };
}

function makeMethod(core: Duplex, id: string, reqName: string) {
	return function(...args: any[]) {
		return core.makeRequest<any>(reqName, { id, args });
	}
}

function makeByteSrcView(info: SourceDetails, core: Duplex):
		{ src: ByteSource; version: number } {
	let reqNames = sourceProxy.reqNames;
	let src: ByteSource = {
		read: makeMethod(core, info.srcId, reqNames.read),
		getSize: makeMethod(core, info.srcId, reqNames.getSize)
	};
	if (info.seekable) {
		src.seek = makeMethod(core, info.srcId, reqNames.seek);
		src.getPosition = makeMethod(core, info.srcId, reqNames.getPosition);
	}
	Object.freeze(src);
	let version = info.version!;
	return { src, version };
}

function makeByteSinkView(info: SinkDetails, core: Duplex):
		{ sink: ByteSink; version: number; } {
	let reqNames = sinkProxy.reqNames;
	let sink: ByteSink = {
		write: makeMethod(core, info.sinkId, reqNames.write),
		getSize: makeMethod(core, info.sinkId, reqNames.getSize),
		setSize: makeMethod(core, info.sinkId, reqNames.setSize),
	};
	if (info.seekable) {
		sink.seek = makeMethod(core, info.sinkId, reqNames.seek);
		sink.getPosition = makeMethod(core, info.sinkId, reqNames.getPosition);
	}
	Object.freeze(sink);
	let version = info.version!;
	return { sink, version };
}

function throwFileReadonlyExc(): never {
	throw new Error(`File is readonly, and writing methods are not available`);
}

function makeFileView(info: FileDetails, core: Duplex): File {
	let reqNames = fileProxy.reqNames;
	let id = info.fileId;
	let file: File = {
		versioned: info.versioned,
		writable: info.writable,
		name: info.name,
		isNew: info.isNew,
		async getByteSource(...args: any[]): Promise<ByteSource> {
			let sInfo = await core.makeRequest<SourceDetails>(
				reqNames.getByteSource, { id, args });
			return makeByteSrcView(sInfo, core).src;
		},
		versionedGetByteSource: ((info.versioned) ?
			async (...args: any[]):
					Promise<{ src: ByteSource; version: number; }> => {
				let sInfo = await core.makeRequest<SourceDetails>(
					reqNames.versionedGetByteSource, { id, args });
				return makeByteSrcView(sInfo, core);
			} : (undefined as any)),
		readBytes: makeMethod(core, id, reqNames.readBytes),
		readTxt: makeMethod(core, id, reqNames.readTxt),
		readJSON: makeMethod(core, id, reqNames.readJSON),
		versionedReadBytes: ((info.versioned) ?
			makeMethod(core, id, reqNames.versionedReadBytes): (undefined as any)),
		versionedReadTxt: ((info.versioned) ?
			makeMethod(core, id, reqNames.versionedReadTxt): (undefined as any)),
		versionedReadJSON: ((info.versioned) ?
			makeMethod(core, id, reqNames.versionedReadJSON): (undefined as any)),
		stat: makeMethod(core, id, reqNames.stat),
		getByteSink: ((info.writable) ?
			async (...args: any[]): Promise<ByteSink> => {
				let sInfo = await core.makeRequest<SinkDetails>(
					reqNames.getByteSink, { id, args });
				return makeByteSinkView(sInfo, core).sink;
			} : throwFileReadonlyExc),
		versionedGetByteSink: ((info.versioned) ? ((info.writable) ?
			async (...args: any[]):
					Promise<{ sink: ByteSink; version: number; }> => {
				let sInfo = await core.makeRequest<SinkDetails>(
					reqNames.versionedGetByteSink, { id, args });
				return makeByteSinkView(sInfo, core);
			} : throwFileReadonlyExc) : (undefined as any)),
		writeBytes: ((info.writable) ?
			makeMethod(core, id, reqNames.writeBytes) : throwFileReadonlyExc),
		writeTxt: ((info.writable) ?
			makeMethod(core, id, reqNames.writeTxt) : throwFileReadonlyExc),
		writeJSON: ((info.writable) ?
			makeMethod(core, id, reqNames.writeJSON) : throwFileReadonlyExc),
		versionedWriteBytes: ((info.versioned) ? ((info.writable) ?
			makeMethod(core, id, reqNames.versionedWriteBytes) :
			throwFileReadonlyExc) : (undefined as any)),
		versionedWriteTxt: ((info.versioned) ? ((info.writable) ?
			makeMethod(core, id, reqNames.versionedWriteTxt) :
			throwFileReadonlyExc) : (undefined as any)),
		versionedWriteJSON: ((info.versioned) ? ((info.writable) ?
			makeMethod(core, id, reqNames.versionedWriteJSON) :
			throwFileReadonlyExc) : (undefined as any)),
		copy: ((info.writable) ?
			async (...args: any[]): Promise<void> => {
				let srcFileId = fileToIdMap.get(args[0]);
				args[0] = srcFileId;
				await core.makeRequest<void>(reqNames.copy, { id, args });
			} : throwFileReadonlyExc),
		versionedCopy: ((info.writable) ?
			(...args: any[]): Promise<number> => {
				let srcFileId = fileToIdMap.get(args[0]);
				args[0] = srcFileId;
				return core.makeRequest<number>(
					reqNames.versionedCopy, { id, args });
			} : throwFileReadonlyExc),
	};
	Object.freeze(file);
	fileToIdMap.set(file, id);
	return file;
}

function makeLinkView(params: fsProxy.LinkDetails, core: Duplex): SymLink {
	let linkId = params.linkId;
	let readonly = params.readonly;
	let link: SymLink;
	if (params.isFile) {
		link = {
			isFile: true,
			readonly,
			target: async (): Promise<File> => {
				let fInfo = await core.makeRequest<FileDetails>(
					linkProxy.reqNames.target, { id: linkId, args: [] });
				return makeFileView(fInfo, core);
			}
		};
	} else if (params.isFolder) {
		link = {
			isFolder: true,
			readonly,
			target: async (): Promise<FS> => {
				let fsInfo = await core.makeRequest<FSDetails>(
					linkProxy.reqNames.target, { id: linkId, args: [] });
				return makeFSView(fsInfo, core);

			}
		};
	} else {
		throw new Error('Link is neither to file, nor to folder');
	}
	Object.freeze(link);
	return link;
}

function throwFSReadonlyExc(): never {
	throw new Error(`File system is readonly, and writing methods are not available`);
}

function makeFSView(info: FSDetails, core: Duplex): FS {
	let id = info.fsId;
	let reqNames = fsProxy.reqNames;
	let fs: FS = {
		versioned: info.versioned,
		writable: info.writable,
		name: info.name,
		async readonlySubRoot(...args: any[]): Promise<FS> {
			let subFSInfo = await core.makeRequest<FSDetails>(
				reqNames.readonlySubRoot, { id, args });
			return makeFSView(subFSInfo, core);
		},
		async getByteSource(...args: any[]): Promise<ByteSource> {
			let sInfo = await core.makeRequest<SourceDetails>(
				reqNames.getByteSource, { id, args });
			return makeByteSrcView(sInfo, core).src;
		},
		versionedGetByteSource: ((info.versioned) ?
			async (...args: any[]):
					Promise<{ src: ByteSource; version: number; }> => {
				let sInfo = await core.makeRequest<SourceDetails>(
					reqNames.versionedGetByteSource, { id, args });
				return makeByteSrcView(sInfo, core);
			} : (undefined as any)),
		async readonlyFile(...args: any[]): Promise<File> {
			let fInfo = await core.makeRequest<FileDetails>(
				reqNames.readonlyFile, { id, args });
			return makeFileView(fInfo, core);
		},
		readJSONFile: makeMethod(core, id, reqNames.readJSONFile),
		readTxtFile: makeMethod(core, id, reqNames.readTxtFile),
		readBytes: makeMethod(core, id, reqNames.readBytes),
		listFolder: makeMethod(core, id, reqNames.listFolder),
		versionedReadJSONFile: ((info.versioned) ? makeMethod(core, id,
			reqNames.versionedReadJSONFile) : (undefined as any)),
		versionedReadTxtFile: ((info.versioned) ? makeMethod(core, id,
			reqNames.versionedReadTxtFile) : (undefined as any)),
		versionedReadBytes: ((info.versioned) ? makeMethod(core, id,
			reqNames.versionedReadBytes) : (undefined as any)),
		versionedListFolder: ((info.versioned) ? makeMethod(core, id,
			reqNames.versionedListFolder) : (undefined as any)),
		checkFolderPresence: makeMethod(
			core, id, reqNames.checkFolderPresence),
		checkFilePresence: makeMethod(
			core, id, reqNames.checkFilePresence),
		statFile: makeMethod(core, id, reqNames.statFile),
		readLink: ((info.versioned) ?
			async (...args: any[]): Promise<SymLink> => {
				let linkInfo = await core.makeRequest<fsProxy.LinkDetails>(
					reqNames.readLink, { id, args });
				return makeLinkView(linkInfo, core);
			} : (undefined as any)),
		close: makeMethod(core, id, reqNames.close),
		writableSubRoot: ((info.versioned) ?
			async (...args: any[]): Promise<FS> => {
				let subFSInfo = await core.makeRequest<FSDetails>(
					reqNames.writableSubRoot, { id, args });
				return makeFSView(subFSInfo, core);
			} : throwFSReadonlyExc),
		getByteSink: ((info.writable) ?
			async (...args: any[]): Promise<ByteSink> => {
				let sInfo = await core.makeRequest<SinkDetails>(
					reqNames.getByteSink, { id, args });
				return makeByteSinkView(sInfo, core).sink;
			} : throwFSReadonlyExc),
		versionedGetByteSink: ((info.versioned) ? ((info.writable) ?
			async (...args: any[]):
					Promise<{ sink: ByteSink; version: number; }> => {
				let sInfo = await core.makeRequest<SinkDetails>(
					reqNames.versionedGetByteSink, { id, args });
				return makeByteSinkView(sInfo, core);
			} : throwFSReadonlyExc) : (undefined as any)),
		writeBytes: ((info.writable) ?
			makeMethod(core, id, reqNames.writeBytes) : throwFSReadonlyExc),
		writeTxtFile: ((info.writable) ?
			makeMethod(core, id, reqNames.writeTxtFile) : throwFSReadonlyExc),
		writeJSONFile: ((info.writable) ?
			makeMethod(core, id, reqNames.writeJSONFile) : throwFSReadonlyExc),
		versionedWriteBytes: ((info.versioned) ? ((info.writable) ?
			makeMethod(core, id, reqNames.versionedWriteBytes) : throwFSReadonlyExc) : (undefined as any)),
		versionedWriteTxtFile: ((info.versioned) ? ((info.writable) ?
			makeMethod(core, id, reqNames.versionedWriteTxtFile) : throwFSReadonlyExc) : (undefined as any)),
		versionedWriteJSONFile: ((info.versioned) ? ((info.writable) ?
			makeMethod(core, id, reqNames.versionedWriteJSONFile) : throwFSReadonlyExc) : (undefined as any)),
		makeFolder: ((info.writable) ?
			makeMethod(core, id, reqNames.makeFolder) : throwFSReadonlyExc),
		deleteFile: ((info.writable) ?
			makeMethod(core, id, reqNames.deleteFile) : throwFSReadonlyExc),
		deleteLink: ((info.writable) ?
			makeMethod(core, id, reqNames.deleteLink) : throwFSReadonlyExc),
		deleteFolder: ((info.writable) ?
			makeMethod(core, id, reqNames.deleteFolder) : throwFSReadonlyExc),
		move: ((info.writable) ?
			makeMethod(core, id, reqNames.move) : throwFSReadonlyExc),
		link: ((info.versioned) ? ((info.writable) ?
			async (path: string, target: File|FS) => {
				let targetIsFolder = !!(<FS> target).listFolder;
				let targetId = (targetIsFolder ?
					fsToIdMap.get(<FS> target) :
					fileToIdMap.get(<File> target));
				if (!targetId) { throw new TypeError('Target object is not known'); }
				let req: fsProxy.RequestToMakeLink = {
					fsId: id, targetIsFolder, targetId, path };
				return core.makeRequest<any>(reqNames.link, req);
			} : throwFSReadonlyExc) : (undefined as any)),
		writableFile: ((info.writable) ?
			async (...args: any[]): Promise<File> => {
				let fInfo = await core.makeRequest<FileDetails>(
					reqNames.writableFile, { id, args });
				return makeFileView(fInfo, core);
			} : throwFSReadonlyExc),
		copyFile: ((info.writable) ?
			makeMethod(core, id, reqNames.copyFile) : throwFSReadonlyExc),
		copyFolder: ((info.writable) ?
			makeMethod(core, id, reqNames.copyFolder) : throwFSReadonlyExc),
		saveFile: ((info.writable) ?
			async (...args: any[]): Promise<void> => {
				let fileId = fileToIdMap.get(args[0]);
				args[0] = fileId;
				await core.makeRequest<void>(
					reqNames.saveFile, { id, args });
			} : throwFSReadonlyExc),
		saveFolder: ((info.writable) ?
			async (...args: any[]): Promise<void> => {
				let fsId = fsToIdMap.get(args[0]);
				args[0] = fsId;
				await core.makeRequest<void>(
					reqNames.saveFolder, { id, args });
			} : throwFSReadonlyExc)
	};
	Object.freeze(fs);
	fsToIdMap.set(fs, id);
	return fs;
}

Object.freeze(exports);