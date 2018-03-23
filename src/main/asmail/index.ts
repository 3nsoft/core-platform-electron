/*
 Copyright (C) 2015 - 2017 3NSoft Inc.
 
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

import { InboxOnServer } from './inbox/service';
import { errWithCause } from '../../lib-common/exceptions/error';
import { KeyRing, makeKeyring, PublishedKeys } from './keyring';
import { ConfigOfASMailServer } from './config';
import { bind } from '../../lib-common/binding';
import { makeInboxCache } from './inbox/cache';
import { makeInboxFS } from '../../lib-client/local-files/app-files';
import { Delivery } from './delivery/service';
import { StorageGetter } from '../../lib-client/3nstorage/xsp-fs/common';
import { GetSigner } from '../id-manager';
import { AsyncSBoxCryptor } from 'xsp-files';

type WritableFS = web3n.files.WritableFS;
type Service = web3n.asmail.Service;
type DeliveryService = web3n.asmail.DeliveryService;
type InboxService = web3n.asmail.InboxService;

const KEYRING_DATA_FOLDER = 'keyring';
const INBOX_DATA_FOLDER = 'inbox';
const CONFIG_DATA_FOLDER = 'config';
const DELIVERY_DATA_FOLDER = 'delivery';

const CACHE_DIR = 'cache';

export class ASMail {
	
	private keyring: KeyRing = (undefined as any);
	private address: string = (undefined as any);
	private getSigner: GetSigner = (undefined as any);
	private inbox: InboxOnServer = (undefined as any);
	private delivery: Delivery = (undefined as any);
	private config: ConfigOfASMailServer = (undefined as any);
	
	constructor(
			private cryptor: AsyncSBoxCryptor) {
		Object.seal(this);
	}
	
	async init(address: string, getSigner: GetSigner,
			syncedFS: WritableFS, localFS: WritableFS,
			getStorages: StorageGetter): Promise<void> {
		try {
			this.address = address;
			this.getSigner = getSigner;
			this.keyring = await makeKeyring(
				await syncedFS.writableSubRoot(KEYRING_DATA_FOLDER));
			this.config = new ConfigOfASMailServer(this.address, this.getSigner);
			this.inbox = new InboxOnServer(this.address, this.getSigner,
				this.keyring, getStorages, this.cryptor);
			this.delivery = new Delivery(this.address, this.getSigner,
				this.keyring, this.config.anonSenderInviteGetter(), this.cryptor);
			await Promise.all([
				(async () => {
					const inboxDevFS = await makeInboxFS(this.address);
					const cacheFS = await inboxDevFS.writableSubRoot(CACHE_DIR);
					const inboxCache = await makeInboxCache(cacheFS);
					await this.inbox.init(inboxCache,
						await syncedFS.writableSubRoot(INBOX_DATA_FOLDER));
				})(),
				this.delivery.init(
					await localFS.writableSubRoot(DELIVERY_DATA_FOLDER)),
				this.config.init(
					await syncedFS.writableSubRoot(CONFIG_DATA_FOLDER),
					new PublishedKeys(this.keyring))
			]);
			await syncedFS.close();
			await localFS.close();
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize ASMail');
		}
	}
	
	makeASMailCAP = (): Service => {
		const w: Service = {
			getUserId: async () => this.address,
			delivery: this.delivery.wrap(),
			inbox: this.inbox.wrap()
		};
		return Object.freeze(w);
	};
	
	async close(): Promise<void> {
		this.keyring.saveChanges();
		await this.keyring.close();
	}
	
}

Object.freeze(exports);