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

import { Storage, wrapStorageImplementation, StorageType, NodesContainer,
	StorageGetter }
	from '../../../lib-client/3nstorage/xsp-fs/common';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { makeObjSource } from './obj-source';
import { FS as DevFS } from '../../../lib-client/local-files/device-fs';
import { NamedProcs } from '../../../lib-common/processes';
import { Files, makeFiles, addDiffSectionTo, DiffInfo } from './files';
import { makeObjExistsExc, makeObjNotFoundExc }
	from '../../../lib-client/3nstorage/exceptions';
import { bytes as randomBytes } from '../../../lib-client/random-node';
import { secret_box as sbox } from 'ecma-nacl';
import { base64urlSafe } from '../../../lib-common/buffer-utils';

class LocalStorage implements Storage {

	public type: StorageType = 'local';
	public nodes = new NodesContainer();
	private files: Files = (undefined as any);
	private objRWProcs = new NamedProcs();

	constructor(private getStorages: StorageGetter) {
		Object.seal(this);
	}
	
	async init(devFS: DevFS): Promise<void> {
		this.files = await makeFiles(devFS);
	}

	storageForLinking(type: StorageType, location?: string): Storage {
		if ((type === 'local') || (type === 'synced')) {
			return this.getStorages(type);
		} else if (type === 'share') {
			return this.getStorages('share', location);
		} else {
			throw new Error(`Getting ${type} storage is not implemented in local storage.`);
		}
	}
	
	generateNewObjId(): string {
		let nonce = randomBytes(sbox.NONCE_LENGTH);
		let id = base64urlSafe.pack(nonce);
		if (this.nodes.reserveId(id)) {
			return id;
		} else {
			return this.generateNewObjId();
		}
	}
	
	async getObj(objId: string): Promise<ObjSource> {
		return this.objRWProcs.startOrChain(objId, async () => {
			let info = await this.files.findObj(objId);
			if (!info || info.isArchived) { throw makeObjNotFoundExc(objId); }
			if (typeof info.currentVersion !== 'number') { throw new Error(
				`Object ${objId} has no current version.`); }
			return makeObjSource(this.files, objId, info.currentVersion);
		});
	}
	
	saveObj(objId: string, src: ObjSource): Promise<void> {
		return this.objRWProcs.startOrChain(objId, async () => {
			let version = src.getObjVersion()!;
			if ((version === 1) && (await this.files.findObj(objId))) {
				throw makeObjExistsExc(objId);
			}
			await this.files.saveObj(objId, src);
		});
	}

	saveNewHeader(objId: string, ver: number, header: Uint8Array):
			Promise<void> {
		return this.objRWProcs.startOrChain(objId, async () => {
			// prepare diff and save file(s)
			let baseVersion = ver - 1;
			let segsSize = await this.files.getSegsSize(objId, baseVersion);
			let diff: DiffInfo = { baseVersion, segsSize, sections: [] };
			addDiffSectionTo(diff.sections, false, 0, segsSize);
			await this.files.saveDiff(objId, ver, diff, header);
		});
	}
	
	removeObj(objId: string): Promise<void> {
		return this.objRWProcs.startOrChain(objId, async () => {
			await this.files.removeObj(objId);
		});
	}
	
	async close(): Promise<void> {
		try {
			// XXX add cleanups
			
		} catch (err) {
			console.error(err);
		}
	}

}
Object.freeze(LocalStorage.prototype);
Object.freeze(LocalStorage);

export async function makeLocalStorage(storeDevFS: DevFS,
		getStorages: StorageGetter): Promise<Storage> {
	let s = new LocalStorage(getStorages);
	await s.init(storeDevFS);
	return wrapStorageImplementation(s);
}

Object.freeze(exports);