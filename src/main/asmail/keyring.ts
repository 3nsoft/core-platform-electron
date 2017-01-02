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

import { FileException } from '../../lib-common/exceptions/file';
import { FS } from '../../lib-client/3nstorage/xsp-fs/common';
import { Storage, KeyRing, makeKeyRing }
	from '../../lib-client/asmail/keyring/index';
import * as confApi from '../../lib-common/service-api/asmail/config';
import { user as midUser } from '../../lib-common/mid-sigs-NaCl-Ed';
import { utf8 } from '../../lib-common/buffer-utils';
import { bind } from '../../lib-common/binding';

export { KeyRing, MsgKeyRole, MsgDecrInfo }
	from '../../lib-client/asmail/keyring/index';

const KEYRING_FNAME = 'keyring.json';

class KeyRingStore implements Storage {
	
	constructor(
			private fs: FS) {
		if (!this.fs) { throw new Error("No file system given."); }
		Object.seal(this);
	}
	
	save(serialForm: string): Promise<void> {
		if (!this.fs) { throw new Error("File system is not setup"); }
		return this.fs.writeTxtFile(KEYRING_FNAME, serialForm);
	}
	
	load(): Promise<string|undefined> {
		if (!this.fs) { throw new Error("File system is not setup"); }
		return this.fs.readTxtFile(KEYRING_FNAME).catch(
			(exc: FileException) => {
				if (!exc.notFound) { throw exc; }
			});
	}
	
	wrap(): Storage {
		let wrap: Storage = {
			load: bind(this, this.load),
			save: bind(this, this.save)
		};
		Object.freeze(wrap);
		return wrap;
	}
	
}
Object.freeze(KeyRingStore);
Object.freeze(KeyRingStore.prototype);

export class PublishedKeys {
	
	getIntroKeyCerts: () => confApi.p.initPubKey.Certs|undefined;
	updateIntroKey: (signer: midUser.MailerIdSigner) => void;
	
	constructor(keyring: KeyRing) {
		this.getIntroKeyCerts = keyring.getPublishedKeyCerts;
		this.updateIntroKey = keyring.updatePublishedKey;
		Object.freeze(this);
	}
	
}
Object.freeze(PublishedKeys.prototype);
Object.freeze(PublishedKeys);

export async function makeKeyring(keyringFS: FS):
		Promise<KeyRing> {
	let keyring = makeKeyRing();
	let keyStore = (new KeyRingStore(keyringFS)).wrap();
	await keyring.init(keyStore);
	return keyring;
}

Object.freeze(exports);