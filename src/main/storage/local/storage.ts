/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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

import { Storage, wrapStorageImplementation, NodesContainer,
	StorageGetter }
	from '../../../lib-client/3nstorage/xsp-fs/common';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { makeObjSource } from './obj-source';
import { NamedProcs } from '../../../lib-common/processes';
import { Files, makeFiles, addDiffSectionTo, DiffInfo } from './files';
import { makeObjExistsExc, makeObjNotFoundExc }
	from '../../../lib-client/3nstorage/exceptions';
import { bytesSync as randomBytes } from '../../../lib-common/random-node';
import { secret_box as sbox } from 'ecma-nacl';
import { base64urlSafe } from '../../../lib-common/buffer-utils';
import { logError } from '../../../lib-client/logging/log-to-file';
import { AsyncSBoxCryptor } from 'xsp-files';

type WritableFS = web3n.files.WritableFS;

class LocalStorage implements Storage {

	public type: web3n.files.FSType = 'local';
	public versioned = true;
	public nodes = new NodesContainer();
	private files: Files = (undefined as any);
	private objWriteProcs = new NamedProcs();

	constructor(
			private getStorages: StorageGetter,
			public cryptor: AsyncSBoxCryptor) {
		Object.seal(this);
	}
	
	async init(devFS: WritableFS): Promise<void> {
		this.files = await makeFiles(devFS);
	}

	storageForLinking(type: web3n.files.FSType, location?: string): Storage {
		if ((type === 'local') || (type === 'synced')) {
			return this.getStorages(type);
		} else if (type === 'share') {
			return this.getStorages('share', location);
		} else {
			throw new Error(`Getting ${type} storage is not implemented in local storage.`);
		}
	}
	
	generateNewObjId(): string {
		const nonce = randomBytes(sbox.NONCE_LENGTH);
		const id = base64urlSafe.pack(nonce);
		if (this.nodes.reserveId(id)) {
			return id;
		} else {
			return this.generateNewObjId();
		}
	}
	
	async getObj(objId: string): Promise<ObjSource> {
		const info = await this.files.findObj(objId);
		if (!info || info.isArchived) { throw makeObjNotFoundExc(objId); }
		if (typeof info.currentVersion !== 'number') { throw new Error(
			`Object ${objId} has no current version.`); }
		return makeObjSource(this.files, objId, info.currentVersion);
	}
	
	saveObj(objId: string, src: ObjSource): Promise<void> {
		return this.objWriteProcs.start(objId, async () => {
			if ((src.version === 1) && (await this.files.findObj(objId))) {
				throw makeObjExistsExc(objId);
			}
			await this.files.saveObj(objId, src);
		});
	}

	removeObj(objId: string): Promise<void> {
		return this.objWriteProcs.start(objId, async () => {
			await this.files.removeObj(objId);
		});
	}
	
	async close(): Promise<void> {
		try {
			// XXX add cleanups
			
		} catch (err) {
			await logError(err);
		}
	}

}
Object.freeze(LocalStorage.prototype);
Object.freeze(LocalStorage);

export async function makeLocalStorage(storeDevFS: WritableFS,
		getStorages: StorageGetter, cryptor: AsyncSBoxCryptor): Promise<Storage> {
	const s = new LocalStorage(getStorages, cryptor);
	await s.init(storeDevFS);
	return wrapStorageImplementation(s);
}

Object.freeze(exports);