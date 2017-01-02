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

import { user as mid } from '../lib-common/mid-sigs-NaCl-Ed';
import { ScryptGenParams } from '../lib-client/key-derivation';
import { secret_box as sbox } from 'ecma-nacl';

export interface IGetSigner {
	(): Promise<mid.MailerIdSigner>;
}

export interface MasterCryptors {
	decr: sbox.Decryptor;
	encr: sbox.Encryptor;
}

export interface IGenerateCrypt {
	(derivParams: ScryptGenParams): Promise<MasterCryptors>;
}

export const channels = {
	storage: 'storage',
	asmail: 'asmail',
	device: 'device',
	signin: 'signin',
	signup: 'signup'
};
Object.freeze(channels);

export namespace signUp {
	
	export const reqNames = {
		isUserActive: 'is-user-active',
		createUserParams: 'create-user-params',
		addUser: 'add-user',
		getAddressesForName: 'get-addresses-for-name'
	};
	Object.freeze(reqNames);
	
}
Object.freeze(signUp);

export namespace signIn {
	
	export const reqNames = {
		getUsersOnDisk: 'get-users-on-disk',
		startLoginToRemoteStorage: 'start-login-to-remote-storage',
		completeLoginAndLocalSetup: 'complete-login-and-local-setup',
		useExistingStorage: 'use-existing-storage'
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
		openAppSyncedFS: 'store/open-app-synced-fs',
		openAppLocalFS: 'store/open-app-local-fs',
	};
	Object.freeze(reqNames);
	
}
Object.freeze(storage);

export interface RequestToProxy {
	id: string;
	args: any[];
}

export namespace fsProxy {

	export const reqNames = {
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
		deleteLink: 'fs/delete-link',
		move: 'fs/move',
		close: 'fs/close',
		checkFolderPresence: 'fs/check-folder-presence',
		checkFilePresence: 'fs/check-file-presence',
		getByteSink: 'fs/get-byte-sink',
		getByteSource: 'fs/get-byte-source',
		readonlySubRoot: 'fs/readonly-sub-root',
		writableSubRoot: 'fs/writable-sub-root',
		readonlyFile: 'fs/readonly-file',
		writableFile: 'fs/writable-file',
		link: 'fs/link',
		readLink: 'fs/read-link',
		copyFile: 'fs/copy-file',
		copyFolder: 'fs/copy-folder',
		saveFile: 'fs/save-file',
		saveFolder: 'fs/save-folder',
		versionedGetByteSink: 'fs/versioned-get-byte-sink',
		versionedGetByteSource: 'fs/versioned-get-byte-source',
		versionedWriteBytes: 'fs/versioned-write-bytes',
		versionedReadBytes: 'fs/versioned-read-bytes',
		versionedWriteTxtFile: 'fs/versioned-write-txt',
		versionedReadTxtFile: 'fs/versioned-read-txt',
		versionedWriteJSONFile: 'fs/versioned-write-json',
		versionedReadJSONFile: 'fs/versioned-read-json',
		versionedListFolder: 'fs/versioned-list-folder',
	};
	Object.freeze(reqNames);
	
	export interface RequestToMakeLink {
		fsId: string;
		targetIsFolder: boolean;
		targetId: string;
		path: string;
	}

	export interface LinkDetails {
		linkId: string;
		readonly: boolean;
		isFolder?: boolean;
		isFile?: boolean;
	}

}
Object.freeze(fsProxy);

export interface SourceDetails {
	srcId: string;
	seekable: boolean;
	version?: number;
}

export interface SinkDetails {
	sinkId: string;
	seekable: boolean;
	version?: number;
}

export interface FileDetails {
	fileId: string;
	versioned: boolean;
	writable: boolean;
	name: string;
	isNew: boolean;
}

export interface FSDetails {
	fsId: string;
	versioned: boolean;
	writable: boolean;
	name: string;
}

export namespace sinkProxy {

	export const reqNames = {
		write: 'sink/write',
		setSize: 'sink/set-size',
		getSize: 'sink/get-size',
		seek: 'sink/seek',
		getPosition: 'sink/get-position'
	};
	Object.freeze(reqNames);

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
	
}
Object.freeze(sourceProxy);

export namespace fileProxy {

	export const reqNames = {
		stat: 'file/stat',
		writeJSON: 'file/write-json',
		readJSON: 'file/read-json',
		writeTxt: 'file/write-text',
		readTxt: 'file/read-text',
		readBytes: 'file/read-bytes',
		writeBytes: 'file/write-bytes',
		getByteSink: 'file/get-byte-sink',
		getByteSource: 'file/get-byte-source',
		versionedWriteJSON: 'file/versioned-write-json',
		versionedReadJSON: 'file/versioned-read-json',
		versionedWriteTxt: 'file/versioned-write-text',
		versionedReadTxt: 'file/versioned-read-text',
		versionedReadBytes: 'file/versioned-read-bytes',
		versionedWriteBytes: 'file/versioned-write-bytes',
		versionedGetByteSink: 'file/versioned-get-byte-sink',
		versionedGetByteSource: 'file/versioned-get-byte-source',
		copy: 'file/copy',
		versionedCopy: 'file/versioned-copy'
	};
	Object.freeze(reqNames);
	
}
Object.freeze(fileProxy);

export namespace linkProxy {

	export const reqNames = {
		target: 'link/target',
	};
	Object.freeze(reqNames);
	
}
Object.freeze(linkProxy);

export namespace device {

	export const uiReqNames = {
		files: {
			openFileDialog: 'files/open-file-dialog',
			saveFileDialog: 'files/save-file-dialog'
		}
	};
	Object.freeze(uiReqNames.files);
	Object.freeze(uiReqNames);

	type FileTypeFilter = web3n.device.files.FileTypeFilter;

	export interface OpenDialogRequest {
		title: string;
		btnLabel: string;
		filters?: FileTypeFilter[];
	}

	export interface OpenFileDialogRequest extends OpenDialogRequest {
		multiSelections: boolean;
	}

	export interface SaveFileDialogRequest extends OpenDialogRequest {
		defaultPath: string;
	}

}
Object.freeze(device);

export namespace asmail {
	
	export const uiReqNames = {
		getUserId: 'get-user-id',
		delivery: {
			sendPreFlight: 'delivery/send-pre-flight',
			addMsg: 'delivery/add-message',
			listMsgs: 'delivery/list-msgs',
			completionOf: 'delivery/completion-of-process',
			currentState: 'delivery/current-state',
			rmMsg: 'delivery/remove-message'
		},
		inbox: {
			listMsgs: 'inbox/list-messages',
			removeMsg: 'inbox/remove-message',
			getMsg: 'inbox/get-message'
		}
	};
	Object.freeze(uiReqNames.delivery);
	Object.freeze(uiReqNames.inbox);
	Object.freeze(uiReqNames);

	export const eventChannels = {
		deliveryProgress: 'delivery/progress'
	};
	Object.freeze(eventChannels);

	export interface DeliveryProgressEvent {
		id: string;
		p: web3n.asmail.DeliveryProgress;
	}

	export interface AttachmentsContainer {
		folders: { [name: string]: string; };
		files: { [name: string]: string; }
	}

	export interface RequestAddMsgToSend {
		sendImmediately: boolean;
		recipients: string[];
		id: string;
		msg: web3n.asmail.OutgoingMessage;
		attachments: AttachmentsContainer|undefined;
		attachmentsFS: string|undefined;
	}

	export interface RequestRmMsgFromSending {
		id: string;
		cancelSending: boolean;
	}

	export function sortMsgByDeliveryTime(a: web3n.asmail.MsgInfo,
			b: web3n.asmail.MsgInfo): number {
		return (a.deliveryTS - b.deliveryTS);
	}
	
}
Object.freeze(asmail);

Object.freeze(exports);