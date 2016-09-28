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
import { wrapFSImplementation as wrapFS } from '../../files';

export type ListingEntry = Web3N.Files.ListingEntry;
export type FS = Web3N.Storage.FS;

export function wrapFSImplementation(impl: FS): FS {
	let w = <FS> wrapFS(impl);
	w.close = bind(impl, impl.close);
	return w;
}

export interface Storage {
	
	/**
	 * @return a promise, resolvable to root key generation parameters.
	 */
	getRootKeyDerivParams(): Promise<ScryptGenParams>;
	
	/**
	 * @param objId
	 * @return a promise, resolvable to source for a requested object
	 */
	getObj(objId: string): Promise<ObjSource>;
	
	/**
	 * @param objId
	 * @param obj is an object source, with object bytes that should be saved
	 * @return a promise, resolvable, when saving completes. Note, that such
	 * completion does not mean that object's version is already synchronized.
	 * All this means is that object's version has been persisted.
	 */
	saveObj(objId: string, obj: ObjSource): Promise<void>;

	/**
	 * @param objId
	 * @param ver is a version number, under which this change is to be stored.
	 * @param header is an object header, that should be recorded as a new object
	 * version.
	 * @return a promise, resolvable, when saving completes. Note, that such
	 * completion does not mean that object's version is already synchronized.
	 * All this means is that object's version has been persisted.
	 */
	saveNewHeader(objId: string, ver: number, header: Uint8Array): Promise<void>;
	
	/**
	 * @param objId
	 * @return a promise, resolvable when object is removed. Note, that such
	 * completion does not mean that object's removal is already synchronized.
	 */
	removeObj(objId: string): Promise<void>;
	
	/**
	 * @return a promise, resolvable when closing cleanup routine completes.
	 */
	close(): Promise<void>;
	
}

export function wrapStorageImplementation(impl: Storage): Storage {
	let wrap: Storage = {
		getObj: bind(impl, impl.getObj),
		saveObj: bind(impl, impl.saveObj),
		saveNewHeader: bind(impl, impl.saveNewHeader),
		close: bind(impl, impl.close),
		getRootKeyDerivParams: bind(impl, impl.getRootKeyDerivParams),
		removeObj: bind(impl, impl.removeObj)
	};
	return wrap;
}

export let sysFolders = {
	appData: 'Apps Data',
	userFiles: 'User Files'
};
Object.freeze(sysFolders);

Object.freeze(exports);