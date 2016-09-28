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
import { storage, sinkProxy, sourceProxy, fsProxy } from './common';
import { wrapFSImplementation } from '../lib-client/3nstorage/xsp-fs/common';

export function makeStorageOnUISide(core: Duplex): Web3N.Storage.Service {
	let s = {
		
		async getAppFS(appDomain: string): Promise<Web3N.Storage.FS> {
			let fsId = await core.makeRequest<string>(
				storage.reqNames.openAppFS, appDomain);
			return makeFSView(fsId, core, storage.reqNames.PREFIX);
		},
		
	};
	Object.freeze(s);
	return s;
}

function makeByteSrcView(srcId: string, seekable: boolean, core: Duplex,
		prefix: string): Web3N.ByteSource {
	function makeMethod(reqName: string) {
		return function(...args: any[]) {
			return core.makeRequest<any>(prefix + reqName, { srcId, args });
		}
	};
	let src: Web3N.ByteSource = {
		read: makeMethod(sourceProxy.reqNames.read),
		getSize: makeMethod(sourceProxy.reqNames.getSize)
	};
	if (seekable) {
		src.seek = makeMethod(sourceProxy.reqNames.seek);
		src.getPosition = makeMethod(sourceProxy.reqNames.getPosition);
	}
	Object.freeze(src);
	return src;
}

function makeByteSinkView(sinkId: string, seekable: boolean, core: Duplex,
		prefix: string): Web3N.ByteSink {
	function makeMethod(reqName: string) {
		return function(...args: any[]) {
			return core.makeRequest<any>(prefix + reqName, { sinkId, args });
		}
	};
	let sink: Web3N.ByteSink = {
		write: makeMethod(sinkProxy.reqNames.write),
		getSize: makeMethod(sinkProxy.reqNames.getSize),
		setSize: makeMethod(sinkProxy.reqNames.setSize),
	};
	if (seekable) {
		sink.seek = makeMethod(sinkProxy.reqNames.seek);
		sink.getPosition = makeMethod(sinkProxy.reqNames.getPosition);
	}
	Object.freeze(sink);
	return sink;
}

function makeFSView(fsId: string, core: Duplex, prefix: string):
		Web3N.Storage.FS {

	function makeMethod(reqName: string) {
		return function(...args: any[]) {
			return core.makeRequest<any>(prefix + reqName, { fsId, args });
		}
	}

	let fs: Web3N.Storage.FS = {
		async makeSubRoot(...args: any[]): Promise<Web3N.Storage.FS> {
			let subFSId = await core.makeRequest<string>(
				prefix + fsProxy.reqNames.makeSubRoot, { fsId, args });
			return makeFSView(subFSId, core, prefix);
		},
		async getByteSink(...args: any[]): Promise<Web3N.ByteSink> {
			let sInfo = await core.makeRequest<fsProxy.SinkDetails>(
				prefix + fsProxy.reqNames.getByteSink, { fsId, args });
			let pref = prefix + fsProxy.reqNames.PREFIX;
			return makeByteSinkView(sInfo.sinkId, sInfo.seekable, core, pref);
		},
		async getByteSource(...args: any[]): Promise<Web3N.ByteSource> {
			let sInfo = await core.makeRequest<fsProxy.SourceDetails>(
				prefix + fsProxy.reqNames.getByteSource, { fsId, args });
			let pref = prefix + fsProxy.reqNames.PREFIX;
			return makeByteSrcView(sInfo.srcId, sInfo.seekable, core, pref);
		},
		async readonlyFile(path: string): Promise<Web3N.Files.File> {
			// XXX add implementation
			throw new Error('Method readonlyFile is not implemented, yet.');
		},
		async writableFile(path: string, create?: boolean, exclusive?: boolean):
				Promise<Web3N.Files.File> {
			// XXX add implementation
			throw new Error('Method writableFile is not implemented, yet.');
		},
		writeJSONFile: makeMethod(fsProxy.reqNames.writeJSONFile),
		readJSONFile: makeMethod(fsProxy.reqNames.readJSONFile),
		writeTxtFile: makeMethod(fsProxy.reqNames.writeTxtFile),
		readTxtFile: makeMethod(fsProxy.reqNames.readTxtFile),
		writeBytes: makeMethod(fsProxy.reqNames.writeBytes),
		readBytes: makeMethod(fsProxy.reqNames.readBytes),
		listFolder: makeMethod(fsProxy.reqNames.listFolder),
		makeFolder: makeMethod(fsProxy.reqNames.makeFolder),
		deleteFolder: makeMethod(fsProxy.reqNames.deleteFolder),
		deleteFile: makeMethod(fsProxy.reqNames.deleteFile),
		move: makeMethod(fsProxy.reqNames.move),
		checkFolderPresence: makeMethod(fsProxy.reqNames.checkFolderPresence),
		checkFilePresence: makeMethod(fsProxy.reqNames.checkFilePresence),
		statFile: makeMethod(fsProxy.reqNames.statFile),
		close: makeMethod(fsProxy.reqNames.close)
	};
	Object.freeze(fs);
	return fs;
}

Object.freeze(exports);