/*
 Copyright (C) 2021 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { workerData, parentPort } from 'worker_threads';

if (!parentPort) {
	throw new Error(`This module can be called as worker's main only`);
}

const zipFilePath = workerData;
if (typeof zipFilePath !== 'string') {
	throw new Error(`Zip file path is missing`);
}

interface Zip {
	getEntries(): ZipEntry[];
	readFile(entry: ZipEntry): Buffer;
}

export interface ZipEntryInfo {
	entryName: string;
	isDirectory: boolean;
}

interface ZipEntry extends ZipEntryInfo {
	name: string;
	extra: Buffer;
	comment: string;
	compressedData: Buffer;
	data: Buffer;
	header: Buffer;
	packHeader(): Buffer;
	toString(): string;
}

export interface ListRequest {
	op: 'list';
}
export interface ReadRequest {
	op: 'read-file';
	entryName: string;
}
type RequestMsg = ListRequest | ReadRequest;

export interface ListReply {
	op: 'list';
	lst: ZipEntryInfo[];
	err?: any;
}
export interface ReadReply {
	op: 'read-file';
	bytes: Uint8Array;
	err?: any;
}
export type ReplyMsg = ListReply | ReadReply;

const AdmZip = require('adm-zip');
let zip: Zip|undefined = undefined;
let entries: Map<string, ZipEntry>;

function setZip(): void {
	zip = (new AdmZip(zipFilePath)) as Zip;
	const lst = zip.getEntries();
	entries = new Map();
	for (const e of lst) {
		entries.set(e.entryName, e);
	}
}

parentPort.on('message', (msg: RequestMsg) => {
	try {
		if (!zip) {
			setZip();
		}
		let reply: ReplyMsg;
		if (msg.op === 'list') {
			reply = {
				op: msg.op,
				lst: Array.from(entries.values()).map(e => ({
					entryName: e.entryName, isDirectory: e.isDirectory
				}))
			};
		} else if (msg.op === 'read-file') {
			const entry = entries!.get(msg.entryName);
			if (!entry) {
				throw new Error(`Unknown zip entry ${msg.entryName}`);
			}
			reply = {
				op: msg.op,
				bytes: zip!.readFile(entry)
			};
		} else {
			throw new Error(`Unknown operation in ${JSON.stringify(msg)}`);
		}
		parentPort!.postMessage(reply);
	} catch (err) {
		const reply = {
			op: msg.op,
			err: err.stack
		};
		parentPort!.postMessage(reply);
	}
});
