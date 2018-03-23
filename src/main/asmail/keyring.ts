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

import { Storage, KeyRing, makeKeyRing }
	from '../../lib-client/asmail/keyring/index';
import * as confApi from '../../lib-common/service-api/asmail/config';
import { user as midUser } from '../../lib-common/mid-sigs-NaCl-Ed';
import { utf8 } from '../../lib-common/buffer-utils';
import { SingleProc } from '../../lib-common/processes';

export { KeyRing, MsgKeyRole, MsgKeyInfo }
	from '../../lib-client/asmail/keyring/index';

type WritableFS = web3n.files.WritableFS;
type FileException = web3n.files.FileException;

const KEYRING_FNAME = 'keyring.json';

function makeSyncedStorage(fs: WritableFS): Storage {
	const proc = new SingleProc();
	const storage: Storage = {
		save: (serialForm: string) => proc.startOrChain(
			() => fs.writeTxtFile(KEYRING_FNAME, serialForm)),
		close: () => fs.close(),
		start: async () => {
			
			// XXX start watching keyring file

		},
		load: () => proc.startOrChain(
			() => fs.readTxtFile(KEYRING_FNAME).catch(notFoundOrReThrow))
	};
	return Object.freeze(storage);
}

/**
 * This is a catch callback, which returns undefined on file(folder) not found
 * exception, and re-throws all other exceptions/errors.
 */
function notFoundOrReThrow(exc: FileException): undefined {
	if (!exc.notFound) { throw exc; }
	return;
}

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

export async function makeKeyring(fs: WritableFS):
		Promise<KeyRing> {
	const keyring = makeKeyRing();
	const keyStore = makeSyncedStorage(fs);
	await keyring.init(keyStore);
	return keyring;
}

Object.freeze(exports);