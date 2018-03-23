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

import { utf8 } from '../../../lib-common/buffer-utils';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { makeDecryptedByteSource, idToHeaderNonce }
	from '../../../lib-common/obj-streaming/crypto';
import { errWithCause } from '../../../lib-common/exceptions/error';
import * as confApi from '../../../lib-common/service-api/asmail/config';
import { MainData, headers, managedFields, MainBody, SuggestedNextKeyPair }
	from './common';
import { MsgKeyRole } from '../keyring/index';
import { makeSegmentsReader, AsyncSBoxCryptor } from 'xsp-files';
import { FolderInfo } from '../../3nstorage/xsp-fs/common';

export { SuggestedNextKeyPair, headers } from './common';

export class OpenedMsg {
	
	private msgKeyRole: MsgKeyRole|undefined = undefined;

	constructor(
			public msgId: string,
			private main: MainData) {
		Object.seal(this);
	}
	
	get establishedKeyChain(): boolean {
		if (!this.msgKeyRole) { throw new Error(
			`Key role is not set in incoming message ${this.msgId}`); }
		return (this.msgKeyRole === 'suggested') ||
			(this.msgKeyRole === 'in_use') ||
			(this.msgKeyRole === 'old');
	}

	setMsgKeyRole(msgKeyRole: MsgKeyRole): void {
		if (this.msgKeyRole) { throw new Error(
			`Cannot set key role twice in incoming message ${this.msgId}`); }
		this.msgKeyRole = msgKeyRole;
	}

	getHeader(name: string): any {
		return this.main[name];
	}

	getSender(): string {
		return this.getHeader(headers.FROM);
	}
	
	getMainBody(): MainBody {
		const body: MainBody = this.getHeader(managedFields.BODY);
		return (body ? body : {});
	}
	
	getNextCrypto(): SuggestedNextKeyPair|undefined {
		return this.getHeader(managedFields.NEXT_CRYPTO);
	}

	getCurrentCryptoCerts(): confApi.p.initPubKey.Certs {
		return this.getHeader(managedFields.CRYPTO_CERTIF);
	}

	getAttachmentsJSON(): FolderInfo|undefined {
		return this.getHeader(managedFields.ATTACHMENTS);
	}
	
}
Object.freeze(OpenedMsg.prototype);
Object.freeze(OpenedMsg);


export async function openMsg(msgId: string, mainObjId: string,
		mainObj: ObjSource, headerOfs: number, fKey: Uint8Array,
		cryptor: AsyncSBoxCryptor): Promise<OpenedMsg> {
	try {
		const byteSrc = await makeDecryptedByteSource(
			mainObj, header => makeSegmentsReader(
				fKey, idToHeaderNonce(mainObjId), 0,
				header.subarray(headerOfs), cryptor));
		const bytes = await byteSrc.read(undefined);
		if (!bytes) { throw new Error(`End of bytes is reached too soon`); }
		const jsonOfMain = JSON.parse(utf8.open(bytes));
		return new OpenedMsg(msgId, jsonOfMain);
	} catch (err) {
		throw errWithCause(err, `Cannot open main object of message ${msgId}`);
	}
}

Object.freeze(exports);