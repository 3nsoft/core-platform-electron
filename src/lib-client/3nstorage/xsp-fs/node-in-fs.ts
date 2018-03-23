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

/**
 * Everything in this module is assumed to be inside of a file system
 * reliance set.
 */

import { AsyncSBoxCryptor, SegmentsWriter, makeSegmentsWriter, SegmentsReader,
	makeSegmentsReader, compareVectors, calculateNonce }
	from 'xsp-files';
import { FolderNode } from './folder-node';
import { base64 } from '../../../lib-common/buffer-utils';
import { SingleProc, Deferred, defer } from '../../../lib-common/processes';
import { ObjSource } from '../../../lib-common/obj-streaming/common';
import { makeObjSourceFromArrays, makeDecryptedByteSource }
	from '../../../lib-common/obj-streaming/crypto';
import * as random from '../../../lib-common/random-node';
import { Node, NodeType, Storage, SyncedStorage } from './common';
import { makeFileException, Code as excCode }
	from '../../../lib-common/exceptions/file';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { StorageException } from '../exceptions';
import { Observable, Subject } from 'rxjs';

const SEG_SIZE = 16;	// in 256-byte blocks = 4K in bytes

const EMPTY_BYTE_ARR = new Uint8Array(0);

export abstract class NodeCrypto {

	protected constructor(
			private zerothHeaderNonce: Uint8Array,
			private key: Uint8Array,
			private cryptor: AsyncSBoxCryptor) {}
	
	wipe(): void {
		if (this.key) {
			this.key.fill(0);
			this.key = (undefined as any);
			this.zerothHeaderNonce.fill(0);
			this.zerothHeaderNonce = (undefined as any);
		}
	}

	compareKey(keyB64: string): boolean {
		const k = base64.open(keyB64);
		return compareVectors(k, this.key);
	}

	fileKeyInBase64(): string {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		return base64.pack(this.key);
	}

	protected segWriter(version: number): Promise<SegmentsWriter> {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		return makeSegmentsWriter(this.key, this.zerothHeaderNonce, version,
			SEG_SIZE, random.bytes, this.cryptor);
	}

	protected segReader(version: number, header: Uint8Array):
			Promise<SegmentsReader> {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		return makeSegmentsReader(this.key, this.zerothHeaderNonce,
			version, header, this.cryptor);
	}

	async packBytes(bytes: Uint8Array|Uint8Array[], version: number):
			Promise<ObjSource> {
		const segWriter = await this.segWriter(version);
		const objSrc = await makeObjSourceFromArrays(bytes, segWriter);
		segWriter.destroy();
		return objSrc;
	}

	async openBytes(src: ObjSource): Promise<Uint8Array> {
		const decSrc = await makeDecryptedByteSource(
			src, header => this.segReader(src.version, header));
		const bytes = await decSrc.read(undefined);
		return (bytes ? bytes : EMPTY_BYTE_ARR);
	}

	reencryptHeader = async (initHeader: Uint8Array, newVersion: number):
			Promise<Uint8Array> => {
		if (!this.key) { throw new Error("Cannot use wiped object."); }
		const headerContent = await this.cryptor.formatWN.open(
			initHeader, this.key);
		const n = calculateNonce(this.zerothHeaderNonce, newVersion);
		return this.cryptor.formatWN.pack(headerContent, n, this.key);
	};

}
Object.freeze(NodeCrypto.prototype);
Object.freeze(NodeCrypto);

export type FSEvent = web3n.files.FolderEvent | web3n.files.FileEvent;
type FileChangeEvent = web3n.files.FileChangeEvent;
type RemovedEvent = web3n.files.RemovedEvent;
type MovedEvent = web3n.files.MovedEvent;

export abstract class NodeInFS<TCrypto extends NodeCrypto>
		implements Node {
	
	protected crypto: TCrypto = (undefined as any);
	
	private writeProc: SingleProc|undefined = undefined;
	protected get transition(): Promise<any>|undefined {
		if (!this.writeProc) { return; }
		return this.writeProc.getP();
	}
	
	get version(): number {
		return this.currentVersion;
	}
	protected setCurrentVersion(newVersion: number) {
		if (!Number.isInteger(newVersion)) { throw new TypeError(
			`Version parameter must be an integer, but ${newVersion} is given`); }
		this.currentVersion = newVersion;
	}
	
	protected constructor(
			protected storage: Storage,
			public type: NodeType,
			public name: string,
			public objId: string,
			private currentVersion: number,
			public parentId: string | undefined) {}
	
	/**
	 * This method deletes object from storage, and detaches this node from
	 * storage.
	 */
	delete(remoteEvent?: boolean): Promise<void> {
		return this.doChange(true, async () => {
			if (!remoteEvent) {
				await this.storage.removeObj(this.objId);
			}
			this.storage.nodes.delete(this);
			this.currentVersion = -1;
			const event: RemovedEvent = {
				type: 'removed',
				path: this.name,
				isRemote: remoteEvent
			};
			this.broadcastEvent(event, true);
		});
	}

	/**
	 * This method runs node changing function in an exclusive manner.
	 * Returned promise resolves to whatever change function returns.
	 * This way of setting up an exclusive transaction is an alternative to using
	 * startTransition() method. Use one or the other depending on convenience.
	 * @param awaitPrevChange is a flag, which true value awaits previous
	 * ongoing change, while false value throws up, refusing to perform
	 * concurrent action (without waiting).
	 * @param change is a function that does an appropriate transition from one
	 * version to another, performing respective storage operations, and setting
	 * new current version, when change has been successful.
	 */
	protected async doChange<T>(awaitPrevChange: boolean,
			change: () => Promise<T>): Promise<T> {
		if (!this.writeProc) {
			this.writeProc = new SingleProc();
		}
		if (!awaitPrevChange && this.writeProc.getP()) {
			throw makeFileException(excCode.concurrentUpdate, this.name+` type ${this.type}`);
		}
		try {
			const res = await this.writeProc.startOrChain(change);
			return res;
		} catch (exc) {
			if (!(exc as web3n.RuntimeException).runtimeException) {
				throw errWithCause(exc, `Cannot save changes to ${this.type} ${this.name}, version ${this.version}`);
			}
			if ((exc as StorageException).type === 'storage') {
				if ((exc as StorageException).concurrentTransaction) {
					throw makeFileException(excCode.concurrentUpdate, this.name, exc);
				} else if ((exc as StorageException).objNotFound) {
					throw makeFileException(excCode.notFound, this.name, exc);
				}
			}
			throw makeFileException(undefined as any, this.name, exc);
		}
	}

	/**
	 * This function resolves conflict with remote version.
	 * Implementation of this function requires that no concurrent local change
	 * occur. Calling process must ensure that no concurrent uploads occur.
	 * @param remoteVersion is an object version on server
	 */
	resolveConflict(remoteVersion: number): Promise<void> {
		return this.doChange(true, async () => {
			if (remoteVersion < this.version) { return; }
			await (this.storage as SyncedStorage).setCurrentSyncedVersion(
				this.objId, remoteVersion);
			this.setCurrentVersion(remoteVersion);
		});
	}

	absorbExternalChange(): Promise<void> {
		return this.doChange(true, async () => {
			const src = await this.storage.getObj(this.objId);
			const newVersion = src.version;
			if (newVersion <= this.version) { return; }
			this.setCurrentVersion(newVersion);
			const event: FileChangeEvent = {
				type: 'file-change',
				path: this.name,
				isRemote: true
			};
			this.broadcastEvent(event);
		});
	}

	protected broadcastEvent(event: FSEvent, complete?: boolean): void {
		if (!this.events) { return; }
		this.events.next(event);
		if (complete) {
			this.events.complete();
		}
	}

	/**
	 * This is a lazily initialized field, when there is an external entity
	 * that wants to see this node's events.
	 */
	private events: Subject<FSEvent>|undefined = undefined;

	get event$(): Observable<FSEvent> {
		if (!this.events) {
			this.events = new Subject<FSEvent>();
		}
		return this.events.asObservable().share();
	}

}
Object.freeze(NodeInFS.prototype);
Object.freeze(NodeInFS);

Object.freeze(exports);