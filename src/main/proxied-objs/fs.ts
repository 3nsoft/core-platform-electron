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

import { Duplex, RequestEnvelope, RequestHandler }
	from '../../lib-common/ipc/electron-ipc';
import { fsProxy, RequestToProxy, FileDetails, SinkDetails, SourceDetails,
	FSDetails }
	from '../../renderer/common';
import { FS, File, SymLink } from '../../lib-client/3nstorage/xsp-fs/common';
import { bind } from '../../lib-common/binding';
import { stringOfB64Chars } from '../../lib-client/random-node';
import { ByteSink, ByteSource } from '../../lib-common/byte-streaming/common';
import { SpecialHandlers, Proxy, ProxyFile, ProxyLink, ProxySink, ProxySource }
	from './proxy';

export interface ProxiedObjGetter {
	getFS(fsId: string): FS|undefined;
	addFS(fs: FS): FSDetails;
	getFile(fileId: string): File|undefined;
	addFile(file: File): FileDetails;
}

export class AllProxies {

	fss: ProxyFS;
	sinks: ProxySink;
	srcs: ProxySource;
	files: ProxyFile;
	links: ProxyLink;
	objGetter: ProxiedObjGetter = {
		getFS: (fsId: string): FS|undefined => {
			return this.fss.getByIdWithoutThrowing(fsId);
		},
		addFS: (fs: FS): FSDetails => {
			return this.fss.registerFS(fs);
		},
		getFile: (fileId: string): File|undefined => {
			return this.files.getByIdWithoutThrowing(fileId);
		},
		addFile: (file: File): FileDetails => {
			return this.files.registerFile(file);
		}
	}

	constructor(rendererSide: Duplex) {
		this.fss = new ProxyFS(rendererSide, this);
		this.sinks = new ProxySink(rendererSide);
		this.srcs = new ProxySource(rendererSide);
		this.files = new ProxyFile(rendererSide, this.sinks, this.srcs);
		this.links = new ProxyLink(rendererSide, this.files, this.fss);
		Object.freeze(this);
	}

}
Object.freeze(AllProxies.prototype);
Object.freeze(AllProxies);

export class ProxyFS extends Proxy<FS> {
	
	constructor(rendererSide: Duplex,
			private proxies: AllProxies) {
		super(rendererSide, 'file system');
		let reqNames = fsProxy.reqNames;
		let specialHandlers: SpecialHandlers = {};
		specialHandlers[reqNames.close] = bind(this, this.handleFSClose);
		specialHandlers[reqNames.readonlySubRoot] =
			bind(this, this.handleMakeReadonlySubRoot);
		specialHandlers[reqNames.writableSubRoot] =
			bind(this, this.handleMakeWritableSubRoot);
		specialHandlers[reqNames.getByteSink] =
			bind(this, this.handleGetByteSink);
		specialHandlers[reqNames.versionedGetByteSink] =
			bind(this, this.handleVersionedGetByteSink);
		specialHandlers[reqNames.getByteSource] =
			bind(this, this.handleGetByteSource);
		specialHandlers[reqNames.versionedGetByteSource] =
			bind(this, this.handleVersionedGetByteSource);
		specialHandlers[reqNames.readonlyFile] =
			bind(this, this.handleReadonlyFile);
		specialHandlers[reqNames.writableFile] =
			bind(this, this.handleWritableFile);
		specialHandlers[reqNames.link] = bind(this, this.handleLink);
		specialHandlers[reqNames.readLink] = bind(this, this.handleReadLink);
		specialHandlers[reqNames.saveFile] = bind(this, this.handleSaveFile);
		specialHandlers[reqNames.saveFolder] = bind(this, this.handleSaveFolder);
		this.attachHandlersToUI(reqNames, specialHandlers);
		Object.freeze(this);
	}

	async close(): Promise<void> {
		let tasks: Promise<void>[] = [];
		for (let o of this.objs.values()) {
			let appFS = o.o;
			tasks.push(appFS.close());
		}
		this.objs.clear();
		await Promise.all(tasks);
	}
	
	registerFS(fs: FS): FSDetails {
		let fsId = this.add(fs);
		let fInfo: FSDetails = {
			fsId,
			versioned: fs.versioned,
			writable: fs.writable,
			name: fs.name
		};
		return fInfo;
	}

	private async handleMakeReadonlySubRoot(
			env: RequestEnvelope<RequestToProxy>): Promise<FSDetails> {
		let fs = this.getById(env.req.id);
		let subFS: FS = await (<any> fs.readonlySubRoot)(...env.req.args);
		return this.registerFS(subFS);
	}
	
	private async handleMakeWritableSubRoot(
			env: RequestEnvelope<RequestToProxy>): Promise<FSDetails> {
		let fs = this.getById(env.req.id);
		let subFS: FS = await (<any> fs.writableSubRoot)(...env.req.args);
		return this.registerFS(subFS);
	}
	
	private async handleGetByteSink(env: RequestEnvelope<RequestToProxy>):
			Promise<SinkDetails> {
		let fs = this.getById(env.req.id);
		let sink: ByteSink = await (<any> fs.getByteSink)(...env.req.args);
		let sinkId = this.proxies.sinks.add(sink);
		let sInfo: SinkDetails = {
			sinkId,
			seekable: !!sink.seek,
		};
		return sInfo;
	}
	
	private async handleVersionedGetByteSink(
			env: RequestEnvelope<RequestToProxy>): Promise<SinkDetails> {
		let fs = this.getById(env.req.id);
		let sink: ByteSink, version: number;
		({ sink, version } = await (<any>
			fs.versionedGetByteSink)(...env.req.args));
		let sinkId = this.proxies.sinks.add(sink);
		let sInfo: SinkDetails = {
			sinkId,
			seekable: !!sink.seek,
			version
		};
		return sInfo;
	}
	
	private async handleGetByteSource(env: RequestEnvelope<RequestToProxy>):
			Promise<SourceDetails> {
		let fs = this.getById(env.req.id);
		let src: ByteSource = await (<any> fs.getByteSource)(...env.req.args);
		let srcId = this.proxies.srcs.add(src);
		let sInfo: SourceDetails = {
			srcId,
			seekable: !!src.seek,
		};
		return sInfo;
	}
	
	private async handleVersionedGetByteSource(
			env: RequestEnvelope<RequestToProxy>): Promise<SourceDetails> {
		let fs = this.getById(env.req.id);
		let src: ByteSource, version: number;
		({ src, version } = await (<any>
			fs.versionedGetByteSource)(...env.req.args));
		let srcId = this.proxies.srcs.add(src);
		let sInfo: SourceDetails = {
			srcId,
			seekable: !!src.seek,
			version
		};
		return sInfo;
	}
	
	private async handleReadonlyFile(env: RequestEnvelope<RequestToProxy>):
			Promise<FileDetails> {
		let fs = this.getById(env.req.id);
		let file: File = await (<any> fs.readonlyFile)(...env.req.args);
		let fileId = this.proxies.files.add(file);
		let fInfo: FileDetails = {
			fileId,
			versioned: file.versioned,
			writable: file.writable,
			name: file.name,
			isNew: file.isNew
		};
		return fInfo;
	}
	
	private async handleWritableFile(env: RequestEnvelope<RequestToProxy>):
			Promise<FileDetails> {
		let fs = this.getById(env.req.id);
		let file: File = await (<any> fs.writableFile)(...env.req.args);
		let fileId = this.proxies.files.add(file);
		let fInfo: FileDetails = {
			fileId,
			versioned: file.versioned,
			writable: file.writable,
			name: file.name,
			isNew: file.isNew
		};
		return fInfo;
	}

	private async handleLink(env: RequestEnvelope<fsProxy.RequestToMakeLink>):
			Promise<void> {
		let fs = this.getById(env.req.fsId);
		let path = env.req.path;
		let targetIsFolder = env.req.targetIsFolder;
		let targetId = env.req.targetId;
		let target: FS|File;
		if (targetIsFolder) {
			target = this.getById(targetId);
		} else {
			target = this.proxies.files.getById(targetId);
		}
		if (!target) { throw new Error(
			`Target object ${targetId} is not known.`); }
		await fs.link(path, target);
	}

	private async handleReadLink(env: RequestEnvelope<RequestToProxy>):
			Promise<fsProxy.LinkDetails> {
		let fs = this.getById(env.req.id);
		let link: SymLink = await (<any> fs.readLink)(...env.req.args);
		let linkId = this.proxies.links.add(link);
		let linkInfo: fsProxy.LinkDetails = {
			linkId,
			readonly: link.readonly
		};
		if (link.isFile) {
			linkInfo.isFile = true;
		} else if (link.isFolder) {
			linkInfo.isFolder = true;
		}
		return linkInfo;
	}

	private async handleSaveFile(env: RequestEnvelope<RequestToProxy>):
			Promise<void> {
		let fs = this.getById(env.req.id);
		let fileToSave = this.proxies.files.getById(env.req.args[0]);
		let args = [ fileToSave ].concat(env.req.args.slice(1));
		await (<any> fs.saveFile)(...args);
	}

	private async handleSaveFolder(env: RequestEnvelope<RequestToProxy>):
			Promise<void> {
		let fs = this.getById(env.req.id);
		let folderToSave = this.getById(env.req.args[0]);
		let args = [ folderToSave ].concat(env.req.args.slice(1));
		await (<any> fs.saveFolder)(...args);
	}

	private async handleFSClose(env: RequestEnvelope<RequestToProxy>):
			Promise<void> {
		let fsId = env.req.id;
		let fs = this.getByIdWithoutThrowing(fsId);
		if (!fs) { return; }
		await fs.close();
		this.objs.delete(fsId);
	}

}
Object.freeze(ProxyFS.prototype);
Object.freeze(ProxyFS);

Object.freeze(exports);