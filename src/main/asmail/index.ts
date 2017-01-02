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

import { Duplex, RequestEnvelope } from '../../lib-common/ipc/electron-ipc';
import { asmail, IGetSigner } from '../../renderer/common';
import { InboxOnServer } from './inbox';
import { errWithCause } from '../../lib-common/exceptions/error';
import { KeyRing, makeKeyring, PublishedKeys } from './keyring';
import { FS } from '../../lib-client/3nstorage/xsp-fs/common';
import { ConfigOfASMailServer } from './config';
import { bind } from '../../lib-common/binding';
import { makeInboxCache } from './inbox-cache';
import { makeInboxFS } from '../../lib-client/local-files/app-files';
import { ProxiedObjGetter } from '../proxied-objs/fs';
import { DeliveryService } from './delivery';
import { StorageGetter } from '../../lib-client/3nstorage/xsp-fs/common';

const KEYRING_DATA_FOLDER = 'keyring';
const INBOX_DATA_FOLDER = 'inbox';
const CONFIG_DATA_FOLDER = 'config';

const CACHE_DIR = 'cache';

export class ASMail {
	
	private uiSide: Duplex = (undefined as any);
	private keyring: KeyRing = (undefined as any);
	private address: string = (undefined as any);
	private getSigner: IGetSigner = (undefined as any);
	private inbox: InboxOnServer = (undefined as any);
	private delivery: DeliveryService = (undefined as any);
	private config: ConfigOfASMailServer = (undefined as any);
	private proxiedObjs: ProxiedObjGetter = (undefined as any);
	
	constructor() {
		Object.seal(this);
	}
	
	async init(address: string, getSigner: IGetSigner, asmailFS: FS,
			getStorages: StorageGetter): Promise<void> {
		try {
			this.address = address;
			this.getSigner = getSigner;
			let keyringFS = await asmailFS.writableSubRoot(KEYRING_DATA_FOLDER);
			this.keyring = await makeKeyring(keyringFS);
			this.config = new ConfigOfASMailServer(this.address, this.getSigner);
			this.inbox = new InboxOnServer(this.address, this.getSigner,
				this.keyring, getStorages);
			this.delivery = new DeliveryService(this.address, this.getSigner,
				this.keyring, this.config.anonSenderInviteGetter());
			await Promise.all([
				(async () => {
					let inboxFS = await asmailFS.writableSubRoot(INBOX_DATA_FOLDER);
					let inboxDevFS = await makeInboxFS(this.address);
					let cacheFS = await inboxDevFS.writableSubRoot(CACHE_DIR);
					let inboxCache = await makeInboxCache(cacheFS);
					await this.inbox.init(inboxCache, inboxFS);
				})(),
				(async () => {
					await this.delivery.init();
				})(),
				(async () => {
					let confFS = await asmailFS.writableSubRoot(CONFIG_DATA_FOLDER);
					await this.config.init(confFS, new PublishedKeys(this.keyring));
				})()
			]);
			await asmailFS.close();
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize ASMail');
		}
	}
	
	attachTo(uiSide: Duplex, proxiedObjs: ProxiedObjGetter): void {
		this.uiSide = uiSide;
		this.proxiedObjs = proxiedObjs;
		this.inbox.attachTo(this.uiSide, this.proxiedObjs.addFS);
		this.delivery.attachTo(this.uiSide, this.proxiedObjs);
		this.attachHandlersToUI();
	}
	
	private attachHandlersToUI(): void {
		let uiReqNames = asmail.uiReqNames;
		this.uiSide.addHandler(uiReqNames.getUserId,
			bind(this, this.handleGetUserId));
	}
	
	private async handleGetUserId(): Promise<string> {
		return this.address;
	}
	
	close(): void {
		this.keyring.saveChanges();
	}
	
}

Object.freeze(exports);