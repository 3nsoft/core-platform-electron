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

import { Duplex, RequestEnvelope }
	from '../../lib-common/ipc/electron-ipc';
import { IGetSigner, IGenerateCrypt, storage, fsProxy, sinkProxy, sourceProxy }
	from '../../renderer/common';
import { FS, Storage as IStorage, sysFolders }
	from '../../lib-client/3nstorage/xsp-fs/common';
import { FS as xspFS } from '../../lib-client/3nstorage/xsp-fs/fs';
import { StorageException as BaseExc, StorageExceptionType }
	from '../../lib-client/3nstorage/exceptions';
import { makeStorageFS } from '../../lib-client/local-files/app-files';
import { make3NStorageOwner } from './stores';
import { getStorageServiceFor } from '../../lib-client/service-locator';
import { bind } from '../../lib-common/binding';
import { makeRuntimeException } from '../../lib-common/exceptions/runtime';
import { stringOfB64Chars } from '../../lib-client/random-node';
import { ByteSink, ByteSource } from '../../lib-common/byte-streaming/common';

export interface StorageException extends BaseExc {
	appName?: string;
	badAppName?: boolean;
	notAllowedToOpenFS?: boolean;
}

function makeBadAppNameExc(appName: string): StorageException {
	let exc = <StorageException> makeRuntimeException(
		'badAppName', StorageExceptionType);
	exc.appName = appName;
	return exc;
}

function makeNotAllowedToOpenFSExc(appName: string): StorageException {
	let exc = <StorageException> makeRuntimeException(
		'notAllowedToOpenFS', StorageExceptionType);
	exc.appName = appName;
	return exc;
}

let CORE_APPS_PREFIX = 'computer.3nweb.core';

export class Storage {
	
	private storage: IStorage = null;
	private rootFS: FS = null;
	private perWinStorages = new Set<PerWinStorage>();
	
	constructor() {
		Object.seal(this);
	}
	
	async initExisting(user: string, getSigner: IGetSigner,
			generateMasterCrypt: IGenerateCrypt):
			Promise<boolean> {
		let storageDevFS = await makeStorageFS(user);
		this.storage = await make3NStorageOwner(
			storageDevFS, user, null, getSigner);
		let params = await this.storage.getRootKeyDerivParams();
		let master = await generateMasterCrypt(params);
		try {
			this.rootFS = await xspFS.makeExisting(
				this.storage, null, master.decr);
		} catch (err) {
			if (err.failedCipherVerification) {
				return false;
			} else {
				throw err;
			}
		} finally {
			master.decr.destroy();
			master.encr.destroy();
		}
		return true;
	}
	
	async initFromRemote(user: string, getSigner: IGetSigner,
			generateMasterCrypt: IGenerateCrypt): Promise<boolean> {
		let serviceURL = await getStorageServiceFor(user);
		let storageDevFS = await makeStorageFS(user);
		this.storage = await make3NStorageOwner(
			storageDevFS, user, serviceURL, getSigner);
		let params = await this.storage.getRootKeyDerivParams();
		let master = await generateMasterCrypt(params);
		try {
			this.rootFS = await xspFS.makeExisting(
				this.storage, null, master.decr);
		} catch (err) {
			if ((<StorageException> err).objNotFound) {
				this.rootFS = await xspFS.makeNewRoot(this.storage, master.encr);
			} else if (err.failedCipherVerification) {
				return false;
			} else {
				throw err;
			}
		} finally {
			master.decr.destroy();
			master.encr.destroy();
		}
		return true;
	}
	
	attachTo(rendererSide: Duplex, policy: StoragePolicy): void {
		let winStorage = new PerWinStorage(this, rendererSide, policy);
		this.perWinStorages.add(winStorage);
	}
	
	makeAppFS(appFolder: string): Promise<FS> {
		if (('string' !== typeof appFolder) ||
				(appFolder.length === 0) ||
				(appFolder.indexOf('/') >= 0)) {
			throw makeBadAppNameExc(appFolder);
		}
		if (!this.rootFS) { throw new Error('Storage is not initialized.'); }
		return this.rootFS.makeSubRoot(sysFolders.appData+'/'+appFolder);
	}
	
	async close(): Promise<void> {
		if (!this.rootFS) { return; }
		let tasks: Promise<void>[] = [];
		for (let s of this.perWinStorages) {
			tasks.push(s.close());
		}
		await Promise.all(tasks);
		await this.rootFS.close();
		tasks.push(this.storage.close());
		this.storage = null;
		this.rootFS = null;
	}
	
}
Object.freeze(Storage.prototype);
Object.freeze(Storage);

export interface StoragePolicy {
	canOpenAppFS(appName: string): boolean;
}

export class PerWinStorage {

	private fss: ProxyFS;
	
	constructor(
			private store: Storage,
			private rendererSide: Duplex,
			private policy: StoragePolicy) {
		this.fss = new ProxyFS(rendererSide, storage.reqNames.PREFIX);
		this.attachHandlersToUI();
		Object.freeze(this);
	}
	
	private attachHandlersToUI(): void {
		let reqNames = storage.reqNames;
		this.rendererSide.addHandler(reqNames.openAppFS,
			bind(this, this.handleOpenAppFS));
	}
	
	private async handleOpenAppFS(env: RequestEnvelope<string>):
			Promise<string> {
		let appFolder = env.req;
		if (typeof appFolder !== 'string') { throw makeBadAppNameExc(appFolder); }
		if (CORE_APPS_PREFIX ===
				appFolder.substring(0, CORE_APPS_PREFIX.length)) {
			throw makeNotAllowedToOpenFSExc(appFolder);
		}
		if (!this.policy.canOpenAppFS(appFolder)) {
			throw makeNotAllowedToOpenFSExc(appFolder); }
		let appFS = await this.store.makeAppFS(appFolder);
		let fsId = this.fss.add(appFS);
		return fsId;
	}
	
	async close(): Promise<void> {
		await this.fss.close();
	}

}
Object.freeze(PerWinStorage.prototype);
Object.freeze(PerWinStorage);

class ProxyFS {
	
	// TODO implement FSView weak-referencing on renderer side, calling
	//		cleanup close()'s, when refs are collected on renderer side.
	// For now, if renderer is not calling close and loose ref, we have a leak.
	private fss = new Map<string, FS>();
	private sinks: ProxySink;
	private srcs: ProxySource;
	
	constructor(
			private rendererSide: Duplex,
			private prefix: string) {
		this.sinks = new ProxySink(
			rendererSide, prefix + fsProxy.reqNames.PREFIX);
		this.srcs = new ProxySource(
			rendererSide, prefix + fsProxy.reqNames.PREFIX);
		this.attachHandlersToUI();
		Object.freeze(this);
	}

	async close(): Promise<void> {
		let tasks: Promise<void>[] = [];
		for (let appFS of this.fss.values()) {
			tasks.push(appFS.close());
		}
		this.fss.clear();
		await Promise.all(tasks);
	}
	
	private attachHandlersToUI(): void {
		let reqNames = fsProxy.reqNames;
		let methodToReq = {
			listFolder: this.prefix + reqNames.listFolder,
			makeFolder: this.prefix + reqNames.makeFolder,
			deleteFolder: this.prefix + reqNames.deleteFolder,
			deleteFile: this.prefix + reqNames.deleteFile,
			writeJSONFile: this.prefix + reqNames.writeJSONFile,
			readJSONFile: this.prefix + reqNames.readJSONFile,
			writeTxtFile: this.prefix + reqNames.writeTxtFile,
			readTxtFile: this.prefix + reqNames.readTxtFile,
			writeBytes: this.prefix + reqNames.writeBytes,
			readBytes: this.prefix + reqNames.readBytes,
			checkFolderPresence: this.prefix + reqNames.checkFolderPresence,
			checkFilePresence: this.prefix + reqNames.checkFilePresence,
			move: this.prefix + reqNames.move,
		};
		for (let methodName of Object.keys(methodToReq)) {
			let reqName = methodToReq[methodName];
			this.rendererSide.addHandler(reqName,
				this.makeHandler(reqName, methodName));
		}
		this.rendererSide.addHandler(this.prefix + reqNames.close,
			bind(this, this.handleFSClose));
		this.rendererSide.addHandler(this.prefix + reqNames.makeSubRoot,
			bind(this, this.handleMakeSubRoot));
		this.rendererSide.addHandler(this.prefix + reqNames.getByteSink,
			bind(this, this.handleGetByteSink));
		this.rendererSide.addHandler(this.prefix + reqNames.getByteSource,
			bind(this, this.handleGetByteSource));
	}

	add(fs: FS): string {
		let fsId = stringOfB64Chars(32);
		while (this.fss.has(fsId)) {
			fsId = stringOfB64Chars(32);
		}
		this.fss.set(fsId, fs);
		return fsId;
	}

	private getFSforRequest(env: RequestEnvelope<fsProxy.RequestToFS>): FS {
		let fs = this.fss.get(env.req.fsId);
		if (!fs) { throw new Error(`Filesystem ${env.req.fsId} is not opened.`); }
		let args = env.req.args;
		if (!Array.isArray(args)) { throw new Error(
			'Parameter args is not an array'); }
		return fs;
	}
	
	private makeHandler(reqName: string, funcName: string) {
		return (env: RequestEnvelope<fsProxy.RequestToFS>) => {
			let fs = this.getFSforRequest(env);
			return fs[funcName](...env.req.args);
		};
	}
	
	private async handleMakeSubRoot(
			env: RequestEnvelope<fsProxy.RequestToFS>): Promise<string> {
		let fs = this.getFSforRequest(env);
		let subFS: FS = await (<any> fs.makeSubRoot)(...env.req.args);
		let fsId = this.add(subFS);
		return fsId;
	}
	
	private async handleGetByteSink(env: RequestEnvelope<fsProxy.RequestToFS>):
			Promise<fsProxy.SinkDetails> {
		let appFS = this.getFSforRequest(env);
		let sink: ByteSink = await (<any> appFS.getByteSink)(...env.req.args);
		let sinkId = this.sinks.add(sink);
		let sInfo: fsProxy.SinkDetails = {
			sinkId,
			seekable: !!sink.seek
		};
		return sInfo;
	}
	
	private async handleGetByteSource(env: RequestEnvelope<fsProxy.RequestToFS>):
			Promise<fsProxy.SourceDetails> {
		let appFS = this.getFSforRequest(env);
		let src: ByteSource = await (<any> appFS.getByteSource)(...env.req.args);
		let srcId = this.srcs.add(src);
		let sInfo: fsProxy.SourceDetails = {
			srcId,
			seekable: !!src.seek
		};
		return sInfo;
	}

	private async handleFSClose(env: RequestEnvelope<fsProxy.RequestToFS>):
			Promise<void> {
		let fsId = env.req.fsId;
		let appFS = this.fss.get(fsId);
		if (!appFS) { return; }
		await appFS.close();
		this.fss.delete(fsId);
	}

}
Object.freeze(ProxyFS.prototype);
Object.freeze(ProxyFS);

class ProxySink {

	private sinks = new Map<string, ByteSink>();
	
	constructor(
			private rendererSide: Duplex,
			private prefix: string) {
		this.attachHandlersToUI();
		Object.freeze(this);
	}
	
	private attachHandlersToUI(): void {
		let reqNames = sinkProxy.reqNames;
		let methodToReq = {
			write: this.prefix + reqNames.write,
			getSize: this.prefix + reqNames.getSize,
			setSize: this.prefix + reqNames.setSize,
			seek: this.prefix + reqNames.seek,
			getPosition: this.prefix + reqNames.getPosition
		};
		for (let methodName of Object.keys(methodToReq)) {
			let reqName = methodToReq[methodName];
			this.rendererSide.addHandler(reqName,
				this.makeHandler(reqName, methodName));
		}
	}

	add(sink: ByteSink): string {
		let sinkId = stringOfB64Chars(32);
		while (this.sinks.has(sinkId)) {
			sinkId = stringOfB64Chars(32);
		}
		this.sinks.set(sinkId, sink);
		setTimeout(() => {
			this.sinks.delete(sinkId);
		}, 5*60000).unref();
		return sinkId;
	}
	
	private makeHandler(reqName: string, funcName: string) {
		return (env: RequestEnvelope<sinkProxy.RequestToSink>) => {
			let sink = this.sinks.get(env.req.sinkId);
			if (!sink) { throw new Error(
				`Byte sink ${env.req.sinkId} is not opened.`); }
			let args = env.req.args;
			if (!Array.isArray(args)) { throw new Error(
				'Parameter args is not an array'); }
			return sink[funcName](...args);
		};
	}

}
Object.freeze(ProxySink.prototype);
Object.freeze(ProxySink);

class ProxySource {

	private srcs = new Map<string, ByteSource>();
	
	constructor(
			private rendererSide: Duplex,
			private prefix: string) {
		this.attachHandlersToUI();
		Object.freeze(this);
	}
	
	private attachHandlersToUI(): void {
		let reqNames = sourceProxy.reqNames;
		let methodToReq = {
			read: this.prefix + reqNames.read,
			getSize: this.prefix + reqNames.getSize,
			seek: this.prefix + reqNames.seek,
			getPosition: this.prefix + reqNames.getPosition
		};
		for (let methodName of Object.keys(methodToReq)) {
			let reqName = methodToReq[methodName];
			this.rendererSide.addHandler(reqName,
				this.makeHandler(reqName, methodName));
		}
	}

	add(src: ByteSource): string {
		let srcId = stringOfB64Chars(32);
		while (this.srcs.has(srcId)) {
			srcId = stringOfB64Chars(32);
		}
		this.srcs.set(srcId, src);
		setTimeout(() => {
			this.srcs.delete(srcId);
		}, 5*60000).unref();
		return srcId;
	}
	
	private makeHandler(reqName: string, funcName: string) {
		return (env: RequestEnvelope<sourceProxy.RequestToSource>) => {
			let src = this.srcs.get(env.req.srcId);
			if (!src) { throw new Error(
				`Byte source ${env.req.srcId} is not opened.`); }
			let args = env.req.args;
			if (!Array.isArray(args)) { throw new Error(
				'Parameter args is not an array'); }
			return src[funcName](...args);
		};
	}

}
Object.freeze(ProxySource.prototype);
Object.freeze(ProxySource);

Object.freeze(exports);