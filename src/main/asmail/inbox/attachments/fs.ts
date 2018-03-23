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

import { Storage, NodesContainer, StorageGetter, FolderInfo }
	from '../../../../lib-client/3nstorage/xsp-fs/common';
import { ObjSource } from '../../../../lib-common/obj-streaming/common';
import { InboxCache } from '../cache';
import { Downloader } from '../downloader';
import { makeCachedObjSource } from '../cached-obj-source';
import { XspFS } from '../../../../lib-client/3nstorage/xsp-fs/fs';
import { AsyncSBoxCryptor } from 'xsp-files';

class AttachmentStore implements Storage {

	public type: web3n.files.FSType = 'asmail-msg';

	public versioned = false;

	public nodes = new NodesContainer();

	constructor(
			private downloader: Downloader,
			private cache: InboxCache, 
			private msgId: string,
			private getStorages: StorageGetter,
			public cryptor: AsyncSBoxCryptor) {
		Object.seal(this);
	}

	storageForLinking(type: web3n.files.FSType, location?: string): Storage {
		if (type === 'share') {
			return this.getStorages('share', location);
		} else {
			throw new Error(`Attachment's storage cannot link to ${type} storage.`);
		}
	}

	generateNewObjId(): never {
		throw new Error(`Attachment's storage is readonly.`);
	}

	getObj(objId: string): Promise<ObjSource> {
		if (typeof objId !== 'string') { throw new Error(`Attachment's storage uses only string objId's, while given parameter is: ${objId}`); }
		return makeCachedObjSource(
			this.cache, this.downloader, this.msgId, objId);
	}
	
	saveObj(objId: string, obj: ObjSource): never {
		throw new Error(`Attachment's storage is readonly.`);
	}

	removeObj(objId: string): never {
		throw new Error(`Attachment's storage is readonly.`);
	}
	
	async close(): Promise<void> {}

}
Object.freeze(AttachmentStore.prototype);
Object.freeze(AttachmentStore);

export function fsForAttachments(downloader: Downloader,
		cache: InboxCache, msgId: string, rootJson: FolderInfo,
		storages: StorageGetter, cryptor: AsyncSBoxCryptor):
		web3n.files.ReadonlyFS {
	const storage = new AttachmentStore(
		downloader, cache, msgId, storages, cryptor);
	const fs = XspFS.makeASMailMsgRootFromJSON(storage, rootJson, 'attachments');
	return fs;
}

Object.freeze(exports);