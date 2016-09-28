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

import * as fErrMod from '../../lib-common/exceptions/file';
import * as xspFS from '../../lib-client/3nstorage/xsp-fs/common';
import * as keyringMod from '../../lib-client/asmail/keyring/index';
import * as confApi from '../../lib-common/service-api/asmail/config';
import * as midSigs from '../../lib-common/mid-sigs-NaCl-Ed';
import { utf8 } from '../../lib-common/buffer-utils';
import { bind } from '../../lib-common/binding';

export { DecryptorWithInfo, KEY_ROLE }
	from '../../lib-client/asmail/keyring/index';

const KEYRING_FNAME = 'keyring.json';

// TODO since storage became simple, and file systems are now given without
//			ability to jump out of it, we may give Keyring its own fs, removing
//			a need to have this storage object outside of keyring's reliance set.

class KeyRingStore implements keyringMod.Storage {
	
	constructor(
			private fs: xspFS.FS) {
		if (!this.fs) { throw new Error("No file system given."); }
		Object.seal(this);
	}
	
	save(serialForm: string): Promise<void> {
		if (!this.fs) { throw new Error("File system is not setup"); }
		return this.fs.writeTxtFile(KEYRING_FNAME, serialForm);
	}
	
	async load(): Promise<string> {
		if (!this.fs) { throw new Error("File system is not setup"); }
		try {
			return await this.fs.readTxtFile(KEYRING_FNAME);
		} catch (exc) {
			if ((<fErrMod.FileException> exc).notFound) { return; }
			else { throw exc; }
		}
	}
	
	wrap(): keyringMod.Storage {
		let wrap: keyringMod.Storage = {
			load: bind(this, this.load),
			save: bind(this, this.save)
		};
		Object.freeze(wrap);
		return wrap;
	}
	
}
Object.freeze(KeyRingStore);
Object.freeze(KeyRingStore.prototype);

export interface KeyRing extends keyringMod.KeyRing { }

export class PublishedKeys {
	
	getIntroKeyCerts: () => confApi.p.initPubKey.Certs;
	updateIntroKey: (signer: midSigs.user.MailerIdSigner) => void;
	
	constructor(keyring: KeyRing) {
		this.getIntroKeyCerts = keyring.getPublishedKeyCerts;
		this.updateIntroKey = keyring.updatePublishedKey;
		Object.freeze(this);
	}
	
}
Object.freeze(PublishedKeys.prototype);
Object.freeze(PublishedKeys);

export async function makeKeyring(keyringFS: xspFS.FS):
		Promise<KeyRing> {
	let keyring = keyringMod.makeKeyRing();
	let keyStore = (new KeyRingStore(keyringFS)).wrap();
	await keyring.init(keyStore);
	return keyring;
}

Object.freeze(exports);