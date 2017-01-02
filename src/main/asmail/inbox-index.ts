/*
 Copyright (C) 2016 3NSoft Inc.
 
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

import { FS } from '../../lib-client/3nstorage/xsp-fs/common';
import { FileException } from '../../lib-common/exceptions/file';
import { keyFromJson } from '../../lib-common/jwkeys';
import { SingleProc } from '../../lib-common/processes';
import { MsgDecrInfo, MsgKeyRole } from './keyring';
import { asmail } from '../../renderer/common';
import { secret_box as sbox } from 'ecma-nacl';
import { base64 } from '../../lib-common/buffer-utils';
import {  FileKeyHolder, makeReadOnlyHolderFor } from 'xsp-files';

interface MsgRecord extends web3n.asmail.MsgInfo {
	key: string;
	keyStatus: MsgKeyRole;
	removeAfter?: number;
}

interface MsgRecords {
	fileTS: number;
	byId: Map<string, MsgRecord>;
	ordered: MsgRecord[];
}

const LIMIT_RECORDS_PER_FILE = 200;

const LATEST_INDEX = 'latest.json';
const INDEX_EXT = '.json';
const INDEX_FNAME_REGEXP = /^\d\.json$/;

// XXX request to 'undefined.json' was spotted, and it probably comes from here.
//		Either ensure that it doesn't happen here, or find it and fix it.

function fileTSOrderComparator(a: number, b: number): number {
	return (a - b);
}

function insertInto(records: MsgRecords, rec: MsgRecord): void {
	records.byId.set(rec.msgId, rec);
	if (records.ordered.length === 0) {
		records.ordered.push(rec);
	} else {
		let ts = rec.deliveryTS;
		for (let i=(records.ordered.length-1); i>=0; i-=1) {
			if (records.ordered[i].deliveryTS <= ts) {
				records.ordered.splice(i+1, 0, rec);
				return;
			}
		}
		records.ordered.splice(0, 0, rec);
	}
}

function removeFrom(records: MsgRecords, msgId: string): void {
	records.byId.delete(msgId);
	for (let i=0; i<records.ordered.length; i+=1) {
		if (records.ordered[i].msgId === msgId) {
			records.ordered.splice(i, 1);
			break;
		}
	}
}

function extractEarlyRecords(records: MsgRecords, recToExtract: number):
		MsgRecords {
	if (records.ordered.length < recToExtract) { throw new Error(
		'Given too few records.'); }
	let byId = new Map<string, MsgRecord>();
	let ordered = records.ordered.splice(0, recToExtract);
	let fileTS = ordered[ordered.length-1].deliveryTS;
	for (let rec of ordered) {
		byId.set(rec.msgId, rec);
		records.byId.delete(rec.msgId);
	}
	return { byId, ordered, fileTS };
}

class TimedObjectCache<TK, TV> {
	
	private cache = new Map<TK, { accessed: number; value: TV }>();
	private timeoutMillis = 10*60*1000;
	
	constructor() {
		setInterval(() => {
			let now = Date.now();
			let toRemove: TK[] = [];
			for (let e of this.cache.entries()) {
				if ((now - e[1].accessed) > this.timeoutMillis) {
					toRemove.push(e[0]);
				}
			}
			for (let key of toRemove) {
				this.cache.delete(key);
			}
		}, 0.5*this.timeoutMillis);
		Object.freeze(this);
	}
	
	put(key: TK, value: TV): void {
		this.cache.set(key, {
			value,
			accessed: Date.now()
		});
	}
	
	get(key: TK): TV|undefined {
		let entry = this.cache.get(key);
		if (!entry) { return; }
		entry.accessed = Date.now();
		return entry.value;
	}
	
}
Object.freeze(TimedObjectCache.prototype);
Object.freeze(TimedObjectCache);

function reduceToMsgInfosInPlace(records: web3n.asmail.MsgInfo[]): void {
	for (let i=0; i<records.length; i+=1) {
		let orig = records[i];
		records[i] = {
			msgId: orig.msgId,
			deliveryTS: orig.deliveryTS
		};
	}
}

/**
 * This is a simple message index, with key storage.
 * Keyring is used only person to current key(s) mapping, and it is not meant
 * to store message keys. Thus, we need this class to hold message keys.
 * When message is opened, index record should be added together with message's
 * key, and when message is deleted, respective record should be deleted.
 * There can be many index files, with messages timestamped in some range. This
 * separation allows for reasonable file sizes and a fast by-timestamp lookup
 * without implementing an actual db.
 */
export class MsgIndex {
	
	private latest: MsgRecords = (undefined as any);
	private cached = new TimedObjectCache<number, MsgRecords>();
	private fileTSs: number[] = (undefined as any);
	private fileProc = new SingleProc<any>();
	
	constructor(
			private inboxFS: FS) {
		if (!this.inboxFS) { throw new Error("No file system given."); }
		Object.seal(this);
	}
	
	/**
	 * @param recs that need to be saved
	 * @return a promise, resolvable when given records are saved. Latest
	 * records can also be chunked and saved as needed. 
	 */
	private async saveRecords(recs: MsgRecords): Promise<void> {
		if (typeof recs.fileTS !== 'number') {
			if (this.latest.ordered.length > 1.25*LIMIT_RECORDS_PER_FILE) {
				let recs = extractEarlyRecords(this.latest, LIMIT_RECORDS_PER_FILE);
				let recsFileTS = recs.ordered[recs.ordered.length-1].deliveryTS;
				let fName = recsFileTS+INDEX_EXT;
				await this.inboxFS.writeJSONFile(fName, recs.ordered);
				this.cached.put(recsFileTS, recs);
				this.fileTSs.push(recsFileTS);
			}
			await this.inboxFS.writeJSONFile(LATEST_INDEX, this.latest.ordered);
		} else {
			let fName = recs.fileTS+INDEX_EXT;
			await this.inboxFS.writeJSONFile(fName, recs.ordered);
			this.cached.put(recs.fileTS, recs);
		}
	}
	
	/**
	 * @param fileTS is index file's timestamp. Undefined value means latest
	 * records.
	 * @return a promise, resolvable to found records, either from a memory
	 * cache, or from a file.
	 */
	private async getRecords(fileTS: number|undefined):
			Promise<MsgRecords|undefined> {
		if (typeof fileTS === 'number') {
			let recs = this.cached.get(fileTS);
			if (recs) { return recs; }
		} else {
			if (this.latest) { return this.latest; }
		}
		let fName = (typeof fileTS === 'number') ?
			`${fileTS}INDEX_EXT` : LATEST_INDEX;
		let ordered = await this.inboxFS.readJSONFile<MsgRecord[]>(fName).catch(
			(exc: FileException) => { if (!exc.notFound) { throw exc; } });
		if (!Array.isArray(ordered)) { return; }
		ordered.sort(asmail.sortMsgByDeliveryTime);
		let byId = new Map<string, MsgRecord>();
		for (let rec of ordered) {
			byId.set(rec.msgId, rec);
		}
		let records = { byId, ordered, fileTS: fileTS! };
		if (typeof fileTS === 'number') {
			this.cached.put(fileTS, records);
		}
		return records;
	}
	
	init(): Promise<void> {
		return this.fileProc.start(async () => {
			
			// 1) initialize latest records index
			let latest = await this.getRecords(undefined);
			if (latest) {
				this.latest = latest;
			} else {
				this.latest = {
					fileTS: (undefined as any),
					byId: new Map<string, MsgRecord>(),
					ordered: []
				};
				await this.saveRecords(this.latest);
			}
			
			// 2) initialize list of file timestamps, that act as index file names
			let files = await this.inboxFS.listFolder('');
			let fileTSs: number[] = [];
			for (let file of files) {
				if (!file.isFile || (file.name === LATEST_INDEX) ||
						!file.name.match(INDEX_FNAME_REGEXP)) { continue; }
				let fileTS = parseInt(file.name.substring(
					0, file.name.length-INDEX_EXT.length));
				fileTSs.push(fileTS);
			}
			fileTSs.sort(fileTSOrderComparator);
			this.fileTSs = fileTSs;
		});
	}
	
	/**
	 * @param msgInfo is a minimal message info object
	 * @param decrInfo
	 * @return a promise, resolvable when given message info bits are recorded. 
	 */
	add(msgInfo: web3n.asmail.MsgInfo, decrInfo: MsgDecrInfo): Promise<void> {
		if (!decrInfo.key) { throw new Error(`Given message decryption info doesn't have a key for message ${msgInfo.msgId}`); }
		let msg: MsgRecord = {
			msgId: msgInfo.msgId,
			deliveryTS: msgInfo.deliveryTS,
			key: decrInfo.key,
			keyStatus: decrInfo.keyStatus,
		};
		return this.fileProc.startOrChain(async () => {
			
			// 1) msg should be inserted into latest part of index
			if ((this.fileTSs.length === 0) ||
					(msg.deliveryTS >= this.fileTSs[this.fileTSs.length-1])) {
				insertInto(this.latest, msg);
				await this.saveRecords(this.latest);
				return;
			}
			
			// 2) find non-latest file for insertion
			let fileTS = this.fileTSs[this.fileTSs.length-1];
			for (let i=(this.fileTSs.length-2); i<=0; i-=1) {
				if (msg.deliveryTS >= this.fileTSs[i]) {
					break;
				} else {
					fileTS = this.fileTSs[i];
				}
			}
			let records = await this.getRecords(fileTS);
			if (!records) { throw new Error(`Expectation fail: there should be some message records.`); }
			insertInto(records, msg);
			await this.saveRecords(records);
		});
	}
	
	private async findRecordsWith(msg: web3n.asmail.MsgInfo):
			Promise<MsgRecords|undefined> {
		// 1) msg should be in latest part of index
		if ((this.fileTSs.length === 0) ||
				(msg.deliveryTS >= this.fileTSs[this.fileTSs.length-1])) {
			if (!this.latest.byId.has(msg.msgId)) { return; }
			return this.latest;
		}
		
		// 2) find non-latest index
		let fileTS = this.fileTSs[this.fileTSs.length-1];
		for (let i=(this.fileTSs.length-2); i<=0; i-=1) {
			if (msg.deliveryTS >= this.fileTSs[i]) {
				let records = await this.getRecords(fileTS);
				if (!records || !records.byId.has(msg.msgId)) {
					if (msg.deliveryTS !== this.fileTSs[i]) { return; }
					fileTS = this.fileTSs[i];
					records = await this.getRecords(fileTS);
					if (!records || !records.byId.has(msg.msgId)) { return; }
				}
				return records;
			} else {
				fileTS = this.fileTSs[i];
			}
		}
		let records = await this.getRecords(this.fileTSs[0]);
		if (!records || !records.byId.has(msg.msgId)) { return; }
		return records;
	}
	
	/**
	 * @param msg is a message identifying info used to find and remove message
	 * @return a promise, resolvable when message is removed from this index.
	 */
	remove(msg: web3n.asmail.MsgInfo): Promise<void> {
		return this.fileProc.startOrChain(async () => {
			let records = await this.findRecordsWith(msg);
			if (!records) { return; }
			removeFrom(records, msg.msgId);
			if ((records.fileTS !== null) && (records.ordered.length === 0)) {
				await this.inboxFS.deleteFile(records.fileTS+INDEX_EXT);
			} else {
				await this.saveRecords(records);
			}
		});
	}
	
	/**
	 * @param msg is an id of a message to remove
	 * @return a promise, resolvable when message is removed from this index.
	 */
	removeUsingIdOnly(msgId: string): Promise<void> {
		return this.fileProc.startOrChain(async () => {
			let records = this.latest;
			let msgFound = records.byId.has(msgId);
			let i = this.fileTSs.length-1;
			while (!msgFound && (i >= 0)) {
				records = (await this.getRecords(this.fileTSs[i]))!;
				msgFound = records.byId.has(msgId);
			}
			if (msgFound) {
				removeFrom(records, msgId);
				if ((records.fileTS !== null) && (records.ordered.length === 0)) {
					await this.inboxFS.deleteFile(records.fileTS+INDEX_EXT);
				} else {
					await this.saveRecords(records);
				}
			}
		});
	}
	
	/**
	 * @param fromTS
	 * @return a promise, resolvable to an ordered array of MsgInfo's that have
	 * delivery timestamp same or later, than the given one.
	 */
	async listMsgs(fromTS: number): Promise<web3n.asmail.MsgInfo[]> {
		return this.fileProc.startOrChain(async () => {
			// find time starting point and get all records
			let list: web3n.asmail.MsgInfo[] = [];
			for (let i=0; i<this.fileTSs.length; i+=1) {
				if (fromTS > this.fileTSs[i]) { continue; }
				let recs = (await this.getRecords(this.fileTSs[i]))!;
				list = list.concat(recs.ordered);
			}
			list = list.concat(this.latest.ordered);
			// truncate records
			for (let i=0; i<list.length; i+=1) {
				if (fromTS >= list[i].deliveryTS) {
					list = list.slice(i);
					break;
				}
			}
			reduceToMsgInfosInPlace(list);
			return list;
		});
	}
	
	/**
	 * This returns a promise of message's file key holder, when message
	 * is found, or of an undefined, when message is not known.
	 * @param msg is a message identifying info used to find message
	 */
	fKeyFor(msg: web3n.asmail.MsgInfo): Promise<FileKeyHolder|undefined> {
		return this.fileProc.startOrChain(async () => {
			let records = await this.findRecordsWith(msg);
			if (!records) { return; }
			let rec = records.byId.get(msg.msgId);
			if (!rec) { return; }
			return makeReadOnlyHolderFor(base64.open(rec.key));
		});
	}
	
}
Object.freeze(MsgIndex.prototype);
Object.freeze(MsgIndex);

Object.freeze(exports);