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

import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { ScryptGenParams } from '../../key-derivation';
import { bind } from '../../../lib-common/binding';
import { wrapFSImplementation as wrapFS, wrapFileImplementation as wrapFile,
	throwFSReadonlyExc, throwFileReadonlyExc }
	from '../../files';

export { FolderJson } from './folder-node'; 

export type ListingEntry = web3n.storage.ListingEntry;
export type FS = web3n.storage.FS;
export type File = web3n.storage.File;
export type SymLink = web3n.storage.SymLink;

export function wrapFSImplementation(impl: FS): FS {
	let fs = <FS> wrapFS(impl);
	fs.readLink = bind(impl, impl.readLink);
	fs.versionedListFolder = bind(impl, impl.versionedListFolder);
	fs.versionedGetByteSource = bind(impl, impl.versionedGetByteSource);
	fs.versionedReadBytes = bind(impl, impl.versionedReadBytes);
	fs.versionedReadJSONFile = bind(impl, impl.versionedReadJSONFile);
	fs.versionedReadTxtFile = bind(impl, impl.versionedReadTxtFile);
	if (impl.writable) {
		fs.link = bind(impl, impl.link);
		fs.deleteLink = bind(impl, impl.deleteLink);
		fs.versionedGetByteSink = bind(impl, impl.versionedGetByteSink);
		fs.versionedWriteBytes = bind(impl, impl.versionedWriteBytes);
		fs.versionedWriteJSONFile = bind(impl, impl.versionedWriteJSONFile);
		fs.versionedWriteTxtFile = bind(impl, impl.versionedWriteTxtFile);
	} else {
		fs.link = throwFSReadonlyExc;
		fs.deleteLink = throwFSReadonlyExc;
		fs.versionedGetByteSink = throwFSReadonlyExc;
		fs.versionedWriteBytes = throwFSReadonlyExc;
		fs.versionedWriteJSONFile = throwFSReadonlyExc;
		fs.versionedWriteTxtFile = throwFSReadonlyExc;
	}
	return fs;
}

export function wrapFileImplementation(impl: File): File {
	let f = <File> wrapFile(impl);
	f.versionedGetByteSource = bind(impl, impl.versionedGetByteSource);
	f.versionedReadBytes = bind(impl, impl.versionedReadBytes);
	f.versionedReadJSON = bind(impl, impl.versionedReadJSON);
	f.versionedReadTxt = bind(impl, impl.versionedReadTxt);
	if (f.writable) {
		f.versionedGetByteSink = bind(impl, impl.versionedGetByteSink);
		f.versionedWriteBytes = bind(impl, impl.versionedWriteBytes);
		f.versionedWriteJSON = bind(impl, impl.versionedWriteJSON);
		f.versionedWriteTxt = bind(impl, impl.versionedWriteTxt);
		f.versionedCopy = bind(impl, impl.versionedCopy);
	} else {
		f.versionedGetByteSink = throwFileReadonlyExc;
		f.versionedWriteBytes = throwFileReadonlyExc;
		f.versionedWriteJSON = throwFileReadonlyExc;
		f.versionedWriteTxt = throwFileReadonlyExc;
		f.versionedCopy = throwFileReadonlyExc;
	}
	return f;
}

export type StorageType = 'synced' | 'local' | 'share' | 'asmail-msg';

export interface Node {
	objId: string;
	name: string;
}

export class NodesContainer {

	private nodes = new Map<string, Node|null>();
	private promises = new Map<string, Promise<Node>>();

	constructor() {
		Object.seal(this);
	}
	
	get<T extends Node>(objId: string): T|undefined {
		let node = this.nodes.get(objId);
		if (!node) { return; }
		return node as T;
	}

	set(node: Node): void {
		let existing = this.nodes.get(node.objId);
		if (existing) { throw new Error(`Cannot add second node for the same id ${node.objId}`); }
		this.nodes.set(node.objId, node);
	}

	getNodeOrPromise<T extends Node>(objId: string):
			{ node?: T, nodePromise?: Promise<T> } {
		let node = this.nodes.get(objId);
		if (node) { return { node: node as T }; }
		return { nodePromise: this.promises.get(objId) as Promise<T> };
	}

	setPromise(objId: string, promise: Promise<Node>): void {
		if (this.nodes.get(objId)) { throw new Error(
			`Cannot set promise for an already set node, id ${objId}.`); }
		let envelopedPromise = (async () => {
			try {
				let node = await promise;
				this.set(node);
				return node;
			} finally {
				this.promises.delete(objId);
			}
		})();
		this.promises.set(objId, envelopedPromise);
	}

	delete(node: Node): boolean {
		let existing = this.get(node.objId);
		if (existing !== node) { return false; }
		this.nodes.delete(node.objId);
		return true;
	}

	reserveId(objId: string): boolean {
		if (this.nodes.has(objId)) { return false; }
		this.nodes.set(objId, null);
		return true;
	}

	clear(): void {
		this.nodes.clear();
		this.nodes = (undefined as any);
	}

}

export interface Storage {
	
	type: StorageType;
	
	nodes: NodesContainer;

	/**
	 * This returns a storage of another type, for use by link functionality.
	 * @param type is a type of a requested storage.
	 * @param location is an additional location parameter for storages that
	 * require further localization, like shared storage.
	 */
	storageForLinking(type: StorageType, location?: string): Storage;
	
	/**
	 * This returns a new objId, reserving it in nodes container.
	 */
	generateNewObjId(): string;

	/**
	 * This returns a promise, resolvable to source for a requested object.
	 * @param objId
	 */
	getObj(objId: string): Promise<ObjSource>;
	
	/**
	 * This saves given object, asynchronously.
	 * @param objId
	 * @param obj is an object source, with object bytes that should be saved
	 */
	saveObj(objId: string, obj: ObjSource): Promise<void>;

	/**
	 * This asynchronously saves a new object version as diff, that has only a
	 * different header.
	 * @param objId
	 * @param ver is a version number, under which this change is to be stored.
	 * @param header is an object header, that should be recorded as a new object
	 * version.
	 */
	saveNewHeader(objId: string, ver: number, header: Uint8Array): Promise<void>;
	
	/**
	 * This asynchronously removes an object. Note that it does not remove
	 * archived version, only current one.
	 * @param objId
	 */
	removeObj(objId: string): Promise<void>;
	
	/**
	 * This asynchronously runs closing cleanup.
	 */
	close(): Promise<void>;
	
}

export function wrapStorageImplementation(impl: Storage): Storage {
	let wrap: Storage = {
		type: impl.type,
		nodes: impl.nodes,
		storageForLinking: bind(impl, impl.storageForLinking),
		generateNewObjId: bind(impl, impl.generateNewObjId),
		getObj: bind(impl, impl.getObj),
		saveObj: bind(impl, impl.saveObj),
		saveNewHeader: bind(impl, impl.saveNewHeader),
		close: bind(impl, impl.close),
		removeObj: bind(impl, impl.removeObj)
	};
	return wrap;
}

export interface StorageGetter {
	(type: StorageType, location?: string): Storage;
}

export interface SyncedStorage extends Storage {

	/**
	 * This returns a promise, resolvable to root key generation parameters.
	 */
	getRootKeyDerivParamsFromServer(): Promise<ScryptGenParams>;

}

export function wrapSyncStorageImplementation(impl: SyncedStorage):
		SyncedStorage {
	let wrap = wrapStorageImplementation(impl) as SyncedStorage;
	wrap.getRootKeyDerivParamsFromServer = bind(impl, impl.getRootKeyDerivParamsFromServer);
	return wrap;
}

export let sysFolders = {
	appData: 'Apps Data',
	userFiles: 'User Files'
};
Object.freeze(sysFolders);

Object.freeze(exports);