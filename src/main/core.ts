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

import { ipcMain, app } from 'electron';
import { commToRenderer } from '../lib-common/ipc/electron-ipc';
import { channels } from '../renderer/common';
import { SignUp } from './signup';
import { makeManager, IdManager } from './id-manager';
import { Storage } from './storage/index';
import { SignIn } from './sign-in';
import { ASMail } from './asmail/index';
import { IGetSigner, IGenerateCrypt } from '../renderer/common';
import { bind } from '../lib-common/binding';
import { assert } from '../lib-common/assert';
import { errWithCause } from '../lib-common/exceptions/error';
import { FS } from '../lib-client/3nstorage/xsp-fs/common';
import { makeCryptor } from '../lib-client/cryptor/cryptor';
import { ClientWin } from '../ui/client';

let ASMAIL_APP_NAME = 'computer.3nweb.core.asmail';
let MAILERID_APP_NAME = 'computer.3nweb.core.mailerid';

export class Core {
	
	private idManager: IdManager;
	private cryptor = makeCryptor();
	private storage: Storage = null;
	private asmail: ASMail = null;
	private signUp: SignUp = null;
	private signIn: SignIn = null;
	private isInitialized = false;
	private isClosed = false;
	
	constructor(
			private signUpUrl: string,
			private switchAppsAfterInit: () => void ) {
		this.idManager = makeManager();
		Object.seal(this);
	}
	
	initServicesWith(w: Electron.BrowserWindow) {
		
		this.storage = new Storage();
		
		this.asmail = new ASMail();
		
		this.signUp = new SignUp(this.signUpUrl,
			commToRenderer(w, channels.signup),
			this.cryptor.cryptor,
			this.idManager,
			bind(this, this.initStorageFromRemote),
			bind(this, this.initCore));
		
		this.signIn = new SignIn(
			commToRenderer(w, channels.signin),
			this.cryptor.cryptor,
			this.idManager,
			bind(this, this.initStorageFromRemote),
			bind(this, this.initExistingStorage),
			bind(this, this.initCore));
		
	}
	
	attachServicesToClientApp(w: ClientWin) {
		
		this.storage.attachTo(
			commToRenderer(w.win, channels.storage),
			w.getStoragePolicy());
		
		this.asmail.attachTo(
			commToRenderer(w.win, channels.asmail));
		
	}
	
	async close(): Promise<void> {
		if (this.isClosed) { return; }
		if (this.isInitialized) {
			this.asmail.close();
			await this.storage.close();
			this.asmail = null;
			this.storage = null;
		}
		this.cryptor.close();
		this.cryptor = null;
		this.isClosed = true;
	}
	
	private async initExistingStorage(user: string,
			genMasterCrypt: IGenerateCrypt): Promise<boolean> {
		return this.storage.initExisting(
			user, this.idManager.getSigner, genMasterCrypt);
	}
	
	private async initStorageFromRemote(genMasterCrypt: IGenerateCrypt):
			Promise<boolean> {
		return this.storage.initFromRemote(
			this.idManager.getId(), this.idManager.getSigner, genMasterCrypt);
	}
	
	private async initCore(user?: string): Promise<void> {
		try {
			let inboxFS = await this.storage.makeAppFS(ASMAIL_APP_NAME);
			let mailerIdFS = await this.storage.makeAppFS(MAILERID_APP_NAME);
			let getSigner = this.idManager.getSigner;
			if (this.idManager.getId()) {
				user = this.idManager.getId();
				let tasks: Promise<void>[] = [];
				tasks.push(this.asmail.init(user, getSigner, inboxFS));
				tasks.push(this.idManager.setStorage(mailerIdFS));
				await Promise.all(tasks);
			} else {
				assert(!!user);
				this.idManager.setAddress(user);
				await this.idManager.setStorage(mailerIdFS);
				await this.asmail.init(user, getSigner, inboxFS);
			}
			this.isInitialized = true;
			setTimeout(() => {
				this.signIn.close();
				this.signIn = null;
				this.signUp.close();
				this.signUp = null;
				this.switchAppsAfterInit(); 
			}, 100);
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize core');
		}
	}
	
}
Object.freeze(Core.prototype);
Object.freeze(Core);

Object.freeze(exports);