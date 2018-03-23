/*
 Copyright (C) 2017 - 2018 3NSoft Inc.

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

import { shell } from 'electron';
import { CAPs, makeCAPs } from '../main/core';
import { MockConfig } from './conf';
import { ASMailMock } from './asmail/service';
import { Storages } from './storage';
import { logError } from '../lib-client/logging/log-to-file';
import { AppManifest } from '../ui/app-settings';

interface MockW3N extends web3n.ui.W3N {
	isMock: true;
}

type FS = web3n.files.FS;

export class Core {

	private mail = new ASMailMock();
	private storages = new Storages();

	constructor(
		private mockConf: MockConfig,
		private viewerOpener: web3n.ui.OpenViewer
	) {
		Object.seal(this);
	}

	async initFor(userId: string): Promise<void> {
		try {
			await this.mail.initFor(userId, this.mockConf.mail);
			await this.storages.initFor(userId);
		} catch (err) {
			await logError(err);
			console.error(`Cannot initialize mock's core: `, err);
			process.exit(-1);
		}
	}
	
	makeCAPs = (appDomain: string, manifest: AppManifest): CAPs => {
		return makeCAPs(appDomain, manifest, this.storages.makeStorageCAP,
			this.mail.makeASMailCAP, this.viewerOpener, this.openerWithOS);
	};

	private openerWithOS = async (fs: FS, path: string): Promise<boolean> => {
		const mountPath = await this.storages.mountOnDeviceFS(fs, path);
		return shell.openItem(mountPath);
	}

}
Object.freeze(Core.prototype);
Object.freeze(Core);

Object.freeze(exports);