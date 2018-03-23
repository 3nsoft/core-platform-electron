/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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

import { KeyRing } from '../keyring';
import { GetSigner } from '../../id-manager';
import { iterFilesIn, iterFoldersIn, isContainerEmpty, addFileTo, addFolderTo }
	from '../../../lib-client/asmail/msg/attachments-container'
import { utf8 } from '../../../lib-common/buffer-utils';
import { AsyncSBoxCryptor } from 'xsp-files';

export type OutgoingMessage = web3n.asmail.OutgoingMessage;
export type AttachmentsContainer = web3n.asmail.AttachmentsContainer;
export type DeliveryProgress = web3n.asmail.DeliveryProgress;
type FS = web3n.files.FS;
type WritableFS = web3n.files.WritableFS;
type File = web3n.files.File;

const ATTACHMENTS_NAME = 'attachments';

export class Attachments {

	private constructor(
			public container: AttachmentsContainer|undefined,
			public fs: FS|undefined) {
		Object.freeze(this);
	}

	static fromMsg(msg: OutgoingMessage): Attachments|undefined {
		if (!isContainerEmpty(msg.attachments)) {
			return new Attachments(msg.attachments, undefined);
		}
		return;
	}

	static async readFrom(msgFS: FS): Promise<Attachments|undefined> {
		if (await msgFS.checkFolderPresence(ATTACHMENTS_NAME)) {
			const container: AttachmentsContainer = {};
			const list = await msgFS.listFolder(ATTACHMENTS_NAME);
			for (const f of list) {
				if (!f.isLink) { continue; }
				const link = await msgFS.readLink(`${ATTACHMENTS_NAME}/${f.name}`);
				if (link.isFile) {
					const file = (await link.target()) as File;
					addFileTo(container, file, f.name);
				} else if (link.isFolder) {
					const fs = (await link.target()) as FS;
					addFolderTo(container, fs, f.name);
				}
			}
			return new Attachments(container, undefined);
		} else if (await msgFS.checkLinkPresence(ATTACHMENTS_NAME)) {
			const linkToAttachments = await msgFS.readLink(ATTACHMENTS_NAME);
			const fs = (await linkToAttachments.target()) as FS;
			return new Attachments(undefined, fs);
		} else {
			return;
		}
	}

	async linkIn(msgFS: WritableFS): Promise<void> {
		if (this.container) {
			await msgFS.makeFolder(ATTACHMENTS_NAME);
			for (const f of iterFilesIn(this.container)) {
				msgFS.link(`${ATTACHMENTS_NAME}/${f.fileName}`, f.file);
			}
			for (const f of iterFoldersIn(this.container)) {
				msgFS.link(`${ATTACHMENTS_NAME}/${f.folderName}`, f.folder);
			}
		} else if (this.fs) {
			msgFS.link(ATTACHMENTS_NAME, this.fs);
		}
	}

	async deleteFrom(msgFS: WritableFS): Promise<void> {
		if (this.container) {
			await msgFS.deleteFolder(ATTACHMENTS_NAME, true).catch(() => {});
		} else if (this.fs) {
			msgFS.deleteLink(ATTACHMENTS_NAME).catch(() => {});
		}
	}

	async estimatedPackedSize(): Promise<number> {
		if (this.container) {
			let totalSize = 0;
			for (const f of iterFilesIn(this.container)) {
				const fileSize = (await f.file.stat()).size;
				if (typeof fileSize === 'number') {
					totalSize += await estimatePackedSizeOf(fileSize);
				}
			}
			for (const f of iterFoldersIn(this.container)) {
				totalSize += await estimatePackedSizeOfFolder(f.folder);
			}
			return totalSize;
		} else if (this.fs) {
			return estimatePackedSizeOfFolder(this.fs);
		} else {
			throw new Error(`Missing both fs and container with attachments.`);
		}
	}

}

async function estimatePackedSizeOfFolder(folder: FS): Promise<number> {
	const list = await folder.listFolder('.');
	let totalSize = 180 + 24*list.length +
		utf8.pack(JSON.stringify(list)).length;
	for (const f of list) {
		if (f.isFile) {
			const fileSize = (await folder.statFile(f.name)).size;
			if (typeof fileSize === 'number') {
				totalSize += await estimatePackedSizeOf(fileSize);
			}
		} else if (f.isFolder) {
			const innerFolder = await folder.readonlySubRoot(f.name);
			totalSize += await estimatePackedSizeOfFolder(innerFolder);
		} else if (f.isLink) {
			// ignoring links for now
		}
	}
	return totalSize;
}

export const SEG_SIZE_IN_K_QUATS = 16;

const SEG_CONTENT_SIZE = 256*SEG_SIZE_IN_K_QUATS - 16;

export function estimatePackedSizeOf(size: number): number {
	const numOfCompleteSegs = Math.floor(size / SEG_CONTENT_SIZE);
	let lastSegSize = size - numOfCompleteSegs*SEG_CONTENT_SIZE;
	if (lastSegSize > 0) {
		lastSegSize += 16;
	}
	return 148 + numOfCompleteSegs*SEG_SIZE_IN_K_QUATS*256 + lastSegSize;
}

export class ResourcesForSending {
	
	constructor(
			public address: string,
			public getSigner: GetSigner,
			public keyring: KeyRing,
			public invitesForAnonReplies: (address: string) => string,
			public cryptor: AsyncSBoxCryptor) {
		Object.seal(this);
	}
	
}

export interface SavedMsgToSend {
	msgToSend: OutgoingMessage;
	sender: string;
	recipients: string[];
}

Object.freeze(exports);