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

import { Duplex, RequestEnvelope, RequestHandler }
	from '../../lib-common/ipc/electron-ipc';
import { sinkProxy, sourceProxy, fileProxy, linkProxy, RequestToProxy,
	FileDetails, FSDetails, SinkDetails, SourceDetails }
	from '../../renderer/common';
import { stringOfB64Chars } from '../../lib-client/random-node';
import { bind } from '../../lib-common/binding';
import { ProxyFS } from './fs';
import { ByteSink, ByteSource }
	from '../../lib-common/byte-streaming/common';
import { File, FS, SymLink } from '../../lib-client/3nstorage/xsp-fs/common';

export interface SpecialHandlers {
	[reqName: string]: RequestHandler<any, any>;
}

export abstract class Proxy<T> {

	// TODO implement FSView weak-referencing on renderer side, calling
	//		cleanup close()'s, when refs are collected on renderer side.
	// For now, if renderer is not calling close and loose ref, we have a leak.
	// While some objects use timed life (TimedProxy). This is also not good.
	objs = new Map<string, { o: T; ts: number; }>();

	constructor(
			private rendererSide: Duplex,
			private objTypeStr: string) {
	}

	attachHandlersToUI(reqNames: any, specialHandlers?: SpecialHandlers): void {
		for (let methodName of Object.keys(reqNames)) {
			let req = reqNames[methodName];
			let handler = (specialHandlers ? specialHandlers[req] : undefined);
			if (!handler) {
				handler = this.makeHandler(methodName);
			}
			this.rendererSide.addHandler(req, handler);
		}
	}

	getByIdWithoutThrowing(id: string): T|undefined {
		let obj = this.objs.get(id);
		if (!obj) { return; }
		obj.ts = Date.now();
		return obj.o;
	}

	getById(id: string): T {
		let o = this.getByIdWithoutThrowing(id);
		if (!o) {
			throw new Error(`${this.objTypeStr} with id ${id} is not found.`);
		}
		return o;
	}

	/**
	 * @param o is an object to add to this proxy
	 * @return an id, under which a given object is registered
	 */
	add(o: T): string {
		let id = stringOfB64Chars(32);
		while (this.objs.has(id)) {
				id = stringOfB64Chars(32);
		}
		this.objs.set(id, { o: o, ts: Date.now() });
		return id;
	}

	/**
	 * @param funcName is name of object's method to invoke in this handler
	 * @return a handler that finds an object, identified in the request, and
	 * invokes its method with arguments from the request.
	 */
	private makeHandler(funcName: string): RequestHandler<RequestToProxy, any> {
		return (env) => {
			let args = env.req.args;
			if (!Array.isArray(args)) { throw new Error(
				'Parameter args is not an array'); }
			let obj = this.getById(env.req.id);
			return obj[funcName](...args);
		};
	}

}
Object.freeze(Proxy.prototype);
Object.freeze(Proxy);

abstract class TimedProxy<T> extends Proxy<T> {

	constructor(rendererSide, objTypeStr) {
		super(rendererSide, objTypeStr);
		setInterval(() => {
			let now = Date.now();
			for (let entry of this.objs.entries()) {
				if ((now - entry[1].ts) < 1800000) {
					this.objs.delete(entry[0]);
				}
			}
		}, 300000).unref();
	}

}
Object.freeze(TimedProxy.prototype);
Object.freeze(TimedProxy);

export class ProxySink extends TimedProxy<ByteSink> {

	constructor(rendererSide: Duplex) {
		super(rendererSide, 'byte-sink');
		this.attachHandlersToUI(sinkProxy.reqNames);
		Object.freeze(this);
	}

}
Object.freeze(ProxySink.prototype);
Object.freeze(ProxySink);

export class ProxySource extends TimedProxy<ByteSource> {

	constructor(rendererSide: Duplex) {
		super(rendererSide, 'byte-source');
		this.attachHandlersToUI(sourceProxy.reqNames);
		Object.freeze(this);
	}

}
Object.freeze(ProxySource.prototype);
Object.freeze(ProxySource);

export class ProxyFile extends TimedProxy<File> {
	
	constructor(rendererSide: Duplex,
			private sinks: ProxySink,
			private srcs: ProxySource) {
		super(rendererSide, 'file');
		let reqNames = fileProxy.reqNames;
		let specialHandlers: SpecialHandlers = {};
		specialHandlers[reqNames.getByteSink] =
			bind(this, this.handleGetByteSink);
		specialHandlers[reqNames.versionedGetByteSink] =
			bind(this, this.handleVersionedGetByteSink);
		specialHandlers[reqNames.getByteSource] =
			bind(this, this.handleGetByteSource);
		specialHandlers[reqNames.versionedGetByteSource] =
			bind(this, this.handleVersionedGetByteSource);
		specialHandlers[reqNames.copy] = bind(this, this.handleCopy);
		specialHandlers[reqNames.versionedCopy] =
			bind(this, this.handleVersionedCopy);
		this.attachHandlersToUI(fileProxy.reqNames, specialHandlers);
		Object.freeze(this);
	}
	
	registerFile(file: File): FileDetails {
		let fileId = this.add(file);
		let fInfo: FileDetails = {
			fileId,
			versioned: file.versioned,
			writable: file.writable,
			name: file.name,
			isNew: file.isNew
		};
		return fInfo;
	}

	private async handleCopy(env: RequestEnvelope<RequestToProxy>):
			Promise<void> {
		let file = this.getById(env.req.id);
		let fileToCopy = this.getById(env.req.args[0]);
		await file.copy(fileToCopy);
	}

	private handleVersionedCopy(env: RequestEnvelope<RequestToProxy>):
			Promise<number> {
		let file = this.getById(env.req.id);
		let fileToCopy = this.getById(env.req.args[0]);
		return file.versionedCopy(fileToCopy);
	}

	private async handleGetByteSink(env: RequestEnvelope<RequestToProxy>):
			Promise<SinkDetails> {
		let file = this.getById(env.req.id);
		let sink = await file.getByteSink();
		let sinkId = this.sinks.add(sink);
		let sInfo: SinkDetails = {
			sinkId,
			seekable: !!sink.seek,
		};
		return sInfo;
	}

	private async handleVersionedGetByteSink(
			env: RequestEnvelope<RequestToProxy>): Promise<SinkDetails> {
		let file = this.getById(env.req.id);
		let { sink, version } = await file.versionedGetByteSink();
		let sinkId = this.sinks.add(sink);
		let sInfo: SinkDetails = {
			sinkId,
			seekable: !!sink.seek,
			version
		};
		return sInfo;
	}

	private async handleGetByteSource(env: RequestEnvelope<RequestToProxy>):
			Promise<SourceDetails> {
		let file = this.getById(env.req.id);
		let src = await file.getByteSource();
		let srcId = this.srcs.add(src);
		let sInfo: SourceDetails = {
			srcId,
			seekable: !!src.seek,
		};
		return sInfo;
	}

	private async handleVersionedGetByteSource(
			env: RequestEnvelope<RequestToProxy>): Promise<SourceDetails> {
		let file = this.getById(env.req.id);
		let { src, version } = await file.versionedGetByteSource();
		let srcId = this.srcs.add(src);
		let sInfo: SourceDetails = {
			srcId,
			seekable: !!src.seek,
			version
		};
		return sInfo;
	}

}
Object.freeze(ProxyFile.prototype);
Object.freeze(ProxyFile);

export class ProxyLink extends TimedProxy<SymLink> {
	constructor(rendererSide: Duplex,
			private files: ProxyFile,
			private fss: ProxyFS) {
		super(rendererSide, 'link');
		let reqNames = linkProxy.reqNames;
		let specialHandlers: SpecialHandlers = {};
		specialHandlers[reqNames.target] = bind(this, this.handleTarget);
		this.attachHandlersToUI(linkProxy.reqNames, specialHandlers);
		Object.freeze(this);
	}

	private async handleTarget(env: RequestEnvelope<RequestToProxy>):
			Promise<FileDetails|FSDetails> {
		let link = this.getById(env.req.id);
		if (link.isFile) {
			let file = await link.target<File>();
			let fileId = this.files.add(file);
			let fInfo: FileDetails = {
				fileId,
				versioned: file.versioned,
				writable: file.writable,
				name: file.name,
				isNew: false
			};
			return fInfo;
		} else if (link.isFolder) {
			let fs = await link.target<FS>();
			let fsId = this.fss.add(fs);
			let fInfo: FSDetails = {
				fsId,
				versioned: fs.versioned,
				writable: fs.writable,
				name: fs.name
			};
			return fInfo;
		} else {
			throw new Error(`Link's target is neither file, nor folder`);
		}
	}
	
}
Object.freeze(ProxyLink.prototype);
Object.freeze(ProxyLink);

Object.freeze(exports);