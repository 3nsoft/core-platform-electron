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

import { Storage, StorageType, NodesContainer, StorageGetter }
	from '../../../lib-client/3nstorage/xsp-fs/common';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { InboxCache } from '../inbox-cache';
import { Downloader } from '../downloader';
import { makeCachedObjSource } from '../cached-obj-source';
import { FolderJsonWithMKey } from '../../../lib-client/asmail/msg';
import { FS } from '../../../lib-client/3nstorage/xsp-fs/fs';

class AttachmentStore implements Storage {

	public type: StorageType = 'asmail-msg';

	public nodes = new NodesContainer();

	constructor(
			private downloader: Downloader,
			private cache: InboxCache, 
			private msgId: string,
			private getStorages: StorageGetter) {
		Object.seal(this);
	}

	storageForLinking(type: StorageType, location?: string): Storage {
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

	saveNewHeader(objId: string, ver: number, header: Uint8Array): never {
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
		cache: InboxCache, msgId: string, rootJson: FolderJsonWithMKey,
		storages: StorageGetter): web3n.storage.FS {
	let storage = new AttachmentStore(downloader, cache, msgId, storages);
	let fs = FS.makeRootFromJSON(
		storage, rootJson.folder, rootJson.mkey, 'attachments');
	return fs;
}

Object.freeze(exports);