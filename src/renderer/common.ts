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

import { user as mid } from '../lib-common/mid-sigs-NaCl-Ed';
import { ScryptGenParams } from '../lib-client/key-derivation';
import { secret_box as sbox } from 'ecma-nacl';

export interface IGetSigner {
	(): Promise<mid.MailerIdSigner>;
}

export interface IGenerateCrypt {
	(derivParams: ScryptGenParams):
		Promise<{ decr: sbox.Decryptor; encr: sbox.Encryptor; }>;
}

export const channels = {
	storage: 'storage',
	asmail: 'asmail',
	signin: 'signin',
	signup: 'signup'
};
Object.freeze(channels);

export namespace signUp {
	
	export const reqNames = {
		isUserActive: 'is-user-active',
		createMidParams: 'create-mailerid-params',
		createStorageParams: 'create-storage-params',
		addUser: 'add-user',
		getAddressesForName: 'get-addresses-for-name'
	};
	Object.freeze(reqNames);
	
}
Object.freeze(signUp);

export namespace signIn {
	
	export const reqNames = {
		getUsersOnDisk: 'get-users-on-disk',
		startMidProv: 'start-mid-provisioning',
		completeMidProv: 'complete-mid-provisioning',
		setupStorage: 'setup-storage',
	};
	Object.freeze(reqNames);
	
	export interface SetupStoreRequest {
		user: string;
		pass: string;
	}	
}
Object.freeze(signIn);

export namespace storage {
	
	export const reqNames = {
		PREFIX: 'store/',
		openAppFS: 'store/open-app-fs',
	};
	Object.freeze(reqNames);
	
}
Object.freeze(storage);

export namespace fsProxy {

	export const reqNames = {
		PREFIX: 'fs/',
		writeBytes: 'fs/write-bytes',
		readBytes: 'fs/read-bytes',
		writeTxtFile: 'fs/write-txt',
		readTxtFile: 'fs/read-txt',
		writeJSONFile: 'fs/write-json',
		readJSONFile: 'fs/read-json',
		listFolder: 'fs/list-folder',
		makeFolder: 'fs/make-folder',
		statFile: 'fs/stat-file',
		deleteFolder: 'fs/delete-folder',
		deleteFile: 'fs/delete-file',
		move: 'fs/move',
		close: 'fs/close',
		checkFolderPresence: 'fs/check-folder-presence',
		checkFilePresence: 'fs/check-file-presence',
		makeSubRoot: 'fs/make-sub-root',
		getByteSink: 'fs/get-byte-sink',
		getByteSource: 'fs/get-byte-source',
	};
	Object.freeze(reqNames);
	
	export interface RequestToFS {
		fsId: string;
		args: any[];
	}
	
	export interface SourceDetails {
		srcId: string;
		seekable: boolean;
	}
	
	export interface SinkDetails {
		sinkId: string;
		seekable: boolean;
	}

}
Object.freeze(fsProxy);

export namespace sinkProxy {

	export const reqNames = {
		write: 'sink/write',
		setSize: 'sink/set-size',
		getSize: 'sink/get-size',
		seek: 'sink/seek',
		getPosition: 'byte-sink/get-position'
	};
	Object.freeze(reqNames);

	export interface RequestToSink {
		sinkId: string;
		args: any[];
	}

}
Object.freeze(sinkProxy);

export namespace sourceProxy {

	export const reqNames = {
		read: 'source/read',
		getSize: 'source/get-size',
		seek: 'source/seek',
		getPosition: 'source/get-position'
	};
	Object.freeze(reqNames);

	export interface RequestToSource {
		srcId: string;
		args: any[];
	}
	
}
Object.freeze(sourceProxy);

export namespace asmail {
	
	export const uiReqNames = {
		getUserId: 'get-user-id',
		sendPreFlight: 'send-pre-flight',
		sendMsg: 'send-message',
		listMsgs: 'list-messages',
		removeMsg: 'remove-message',
		getMsg: 'get-message',
	};
	Object.freeze(uiReqNames);

	export interface RequestSendMsg {
		recipient: string;
		msg: Web3N.ASMail.OutgoingMessage;
	}

	export function sortMsgByDeliveryTime(a: Web3N.ASMail.MsgInfo,
			b: Web3N.ASMail.MsgInfo): number {
		return (a.deliveryTS - b.deliveryTS);
	}
	
}
Object.freeze(asmail);

Object.freeze(exports);