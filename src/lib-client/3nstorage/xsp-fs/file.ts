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

/**
 * Everything in this module is assumed to be inside of a file system
 * reliance set.
 */

import { FileException, makeFileException, Code as excCode }
	from '../../../lib-common/exceptions/file';
import { Linkable, LinkParameters, ByteSink, ByteSource } from '../../files';
import { FileNode, FileLinkParams } from './file-node';
import { utf8 } from '../../../lib-common/buffer-utils';
import { Storage, wrapFileImplementation } from './common';
import { pipe } from '../../../lib-common/byte-streaming/pipe';

export type File = web3n.storage.File;
export type FileStats = web3n.storage.FileStats;

export async function readBytesFrom(src: ByteSource,
		start: number|undefined, end: number|undefined):
		Promise<Uint8Array|undefined> {
	if ((typeof start === 'number') && (start < 0)) { throw new Error(
		`Parameter start has bad value: ${start}`); }
	if ((typeof end === 'number') && (end < 0)) { throw new Error(
		`Parameter end has bad value: ${end}`); }
	let size = await src.getSize();
	if (typeof size !== 'number') { throw new Error(
		'File size is not known.'); }
	if (size === 0) { return; }
	if (typeof start === 'number') {
		if (start >= size) { return; }
		if (typeof end === 'number') {
			end = Math.min(size, end);
			if (end <= start) { return; }
		} else {
			end = size;
		}
		if (!src.seek) { throw new Error('Byte source is not seekable.'); }
		await src.seek(start);
		let bytes = await src.read(end - start);
		return bytes;
	} else {
		let bytes = await src.read(undefined);
		return bytes;
	}
}

export class FileObject implements File, Linkable {

	public versioned = true;

	private constructor(public name: string,
			public isNew: boolean,
			private node: FileNode | undefined,
			private makeNode: (() => Promise<FileNode>) | undefined,
			public writable: boolean) {
		Object.seal(this);
	}

	static makeExisting(node: FileNode, writable: boolean): File {
		let f = new FileObject(node.name, false, node, undefined, writable);
		return wrapFileImplementation(f);
	}

	static makeForNotExisiting(name: string,
			makeNode: () => Promise<FileNode>): File {
		let f = new FileObject(name, true, undefined, makeNode, true);
		return wrapFileImplementation(f);
	}

	static async makeFileFromLinkParams(storage: Storage,
			params: LinkParameters<FileLinkParams>): Promise<File> {
		let node = await FileNode.makeForLinkParams(storage, params.params);
		return FileObject.makeExisting(node, !params.readonly);
	}

	async getLinkParams(): Promise<LinkParameters<FileLinkParams>> {
		if (!this.node) { throw new Error(
			'File does not exist, yet, and cannot be linked.'); }
		let linkParams = this.node.getParamsForLink();
		linkParams.params.fileName = this.name;
		linkParams.readonly = !this.writable;
		return linkParams;
	}

	async versionedGetByteSink():
			Promise<{ sink: web3n.ByteSink; version: number; }> {
		if (!this.node) {
			this.node = await this.makeNode!();
			this.makeNode = undefined;
		}
		return this.node.writeSink();
	}

	async getByteSink(): Promise<web3n.ByteSink> {
		let { sink } = await this.versionedGetByteSink();
		return sink;
	}
	
	async versionedGetByteSource():
			Promise<{ src: web3n.ByteSource; version: number; }> {
		if (!this.node) { throw makeFileException(excCode.notFound, this.name); }
		return this.node.readSrc();
	}

	async getByteSource(): Promise<web3n.ByteSource> {
		let { src } = await this.versionedGetByteSource();
		return src;
	}

	async versionedWriteBytes(bytes: Uint8Array): Promise<number> {
		if (!this.node) {
			this.node = await this.makeNode!();
			this.makeNode = undefined;
		}
		return this.node.save(bytes);
	}

	async writeBytes(bytes: Uint8Array): Promise<void> {
		await this.versionedWriteBytes(bytes);
	}

	versionedWriteTxt(txt: string): Promise<number> {
		let bytes = utf8.pack(txt);
		return this.versionedWriteBytes(bytes);
	}

	async writeTxt(txt: string): Promise<void> {
		await this.versionedWriteTxt(txt);
	}

	versionedWriteJSON(json: any): Promise<number> {
		return this.versionedWriteTxt(JSON.stringify(json));
	}

	async writeJSON(json: any): Promise<void> {
		await this.versionedWriteJSON(json);
	}

	async versionedReadBytes(start?: number, end?: number):
			Promise<{ bytes: Uint8Array|undefined; version: number; }> {
		let { src, version } = await this.versionedGetByteSource();
		let bytes = await readBytesFrom(src, start, end);
		return { bytes, version };
	}
	
	async readBytes(start?: number, end?: number):
			Promise<Uint8Array|undefined> {
		let { bytes } = await this.versionedReadBytes(start, end);
		return bytes;
	}

	async versionedReadTxt(): Promise<{ txt: string; version: number; }> {
		let { bytes, version } = await this.versionedReadBytes();
		let txt = (bytes ? utf8.open(bytes) : '');
		return { txt, version };
	}

	async readTxt(): Promise<string> {
		let { txt } = await this.versionedReadTxt();
		return txt;
	}

	async versionedCopy(file: web3n.files.File): Promise<number> {
		let { version, sink } = await this.versionedGetByteSink();
		let src = await file.getByteSource();
		await pipe(src, sink);
		return version;
	}

	async copy(file: web3n.files.File): Promise<void> {
		let sink = await this.getByteSink();
		let src = await file.getByteSource();
		await pipe(src, sink);
	}

	async versionedReadJSON<T>(): Promise<{ json: T; version: number; }> {
		let { txt, version } = await this.versionedReadTxt();
		let json = JSON.parse(txt);
		return { json, version };
	}

	async readJSON<T>(): Promise<T> {
		let { json, version } = await this.versionedReadJSON<T>();
		return json;
	}

	async stat(): Promise<FileStats> {
		if (!this.node) { throw makeFileException(excCode.notFound, this.name); }
		let { src } = await this.node.readSrc();
		let stat: FileStats = {
			size: await src.getSize(),
			version: this.node.version
		};
		return stat;
	}

}
Object.freeze(FileObject.prototype);
Object.freeze(FileObject);

Object.freeze(exports);