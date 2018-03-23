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

/**
 * Everything in this module is assumed to be inside of a file system
 * reliance set.
 */

import { FileException, makeFileException, Code as excCode }
	from '../../../lib-common/exceptions/file';
import { Linkable, LinkParameters, wrapReadonlyFile,
	wrapWritableFile }
	from '../../files';
import { FileNode, FileLinkParams } from './file-node';
import { utf8 } from '../../../lib-common/buffer-utils';
import { Storage } from './common';
import { pipe } from '../../../lib-common/byte-streaming/pipe';
import { bind } from '../../../lib-common/binding';

type ByteSource = web3n.ByteSource;
type ByteSink = web3n.ByteSink;
type FileStats = web3n.files.FileStats;
type File = web3n.files.File;
type WritableFile = web3n.files.WritableFile;
type ReadonlyFile = web3n.files.ReadonlyFile;

export async function readBytesFrom(src: ByteSource,
		start: number|undefined, end: number|undefined):
		Promise<Uint8Array|undefined> {
	if ((typeof start === 'number') && (start < 0)) { throw new Error(
		`Parameter start has bad value: ${start}`); }
	if ((typeof end === 'number') && (end < 0)) { throw new Error(
		`Parameter end has bad value: ${end}`); }
	const size = await src.getSize();
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
		const bytes = await src.read(end - start);
		return bytes;
	} else {
		const bytes = await src.read(undefined);
		return bytes;
	}
}

export class FileObject implements WritableFile, Linkable {

	v: V;

	private constructor(public name: string,
			public isNew: boolean,
			node: FileNode | undefined,
			makeOrGetNode: (() => Promise<FileNode>) | undefined,
			public writable: boolean) {
		this.v = new V(name, node, makeOrGetNode, writable);
		Object.seal(this);
	}

	static makeExisting(node: FileNode, writable: boolean):
			WritableFile | ReadonlyFile {
		const f = new FileObject(node.name, false, node, undefined, writable);
		return (writable ?
			wrapWritableFile(f) : wrapReadonlyFile(f));
	}

	static makeForNotExisiting(name: string, makeNode: () => Promise<FileNode>):
			WritableFile {
		const f = new FileObject(name, true, undefined, makeNode, true);
		return wrapWritableFile(f);
	}

	static async makeFileFromLinkParams(storage: Storage,
			params: LinkParameters<FileLinkParams>):
			Promise<WritableFile | ReadonlyFile> {
		const node = await FileNode.makeFromLinkParams(storage, params.params);
		return FileObject.makeExisting(node, !params.readonly);
	}

	async getLinkParams(): Promise<LinkParameters<FileLinkParams>> {
		if (!this.v.node) { throw new Error(
			'File does not exist, yet, and cannot be linked.'); }
		const linkParams = this.v.node.getParamsForLink();
		linkParams.params.fileName = this.name;
		linkParams.readonly = !this.writable;
		return linkParams;
	}

	async stat(): Promise<FileStats> {
		if (!this.v.node) { throw makeFileException(excCode.notFound, this.name); }
		const { src } = await this.v.node.readSrc();
		const stat: FileStats = {
			size: await src.getSize(),
			version: this.v.node.version
		};
		return stat;
	}

	async readBytes(start?: number, end?: number):
			Promise<Uint8Array|undefined> {
		const { bytes } = await this.v.readBytes(start, end);
		return bytes;
	}

	async readTxt(): Promise<string> {
		const { txt } = await this.v.readTxt();
		return txt;
	}

	async readJSON<T>(): Promise<T> {
		const { json } = await this.v.readJSON<T>();
		return json;
	}

	async getByteSource(): Promise<web3n.ByteSource> {
		const { src } = await this.v.getByteSource();
		return src;
	}

	async writeBytes(bytes: Uint8Array): Promise<void> {
		await this.v.writeBytes(bytes);
	}

	async writeTxt(txt: string): Promise<void> {
		await this.v.writeTxt(txt);
	}

	async writeJSON(json: any): Promise<void> {
		await this.v.writeJSON(json);
	}

	async getByteSink(): Promise<web3n.ByteSink> {
		const { sink } = await this.v.getByteSink();
		return sink;
	}

	async copy(file: File): Promise<void> {
		await this.v.copy(file);
	}

}
Object.freeze(FileObject.prototype);
Object.freeze(FileObject);

type WritableFileVersionedAPI = web3n.files.WritableFileVersionedAPI;

class V implements WritableFileVersionedAPI {

	constructor(public name: string,
			public node: FileNode | undefined,
			private makeOrGetNode: (() => Promise<FileNode>) | undefined,
			public writable: boolean) {
		Object.seal(this);
	}

	async getLinkParams(): Promise<LinkParameters<FileLinkParams>> {
		if (!this.node) { throw new Error(
			'File does not exist, yet, and cannot be linked.'); }
		const linkParams = this.node.getParamsForLink();
		linkParams.params.fileName = this.name;
		linkParams.readonly = !this.writable;
		return linkParams;
	}

	async getByteSink(): Promise<{ sink: web3n.ByteSink; version: number; }> {
		if (!this.node) {
			this.node = await this.makeOrGetNode!();
			this.makeOrGetNode = undefined;
		}
		return this.node.writeSink();
	}
	
	async getByteSource(): Promise<{ src: web3n.ByteSource; version: number; }> {
		if (!this.node) { throw makeFileException(excCode.notFound, this.name); }
		return this.node.readSrc();
	}

	async writeBytes(bytes: Uint8Array): Promise<number> {
		if (!this.node) {
			this.node = await this.makeOrGetNode!();
			this.makeOrGetNode = undefined;
		}
		return this.node.save(bytes);
	}

	writeTxt(txt: string): Promise<number> {
		const bytes = utf8.pack(txt);
		return this.writeBytes(bytes);
	}

	writeJSON(json: any): Promise<number> {
		return this.writeTxt(JSON.stringify(json));
	}

	async readBytes(start?: number, end?: number):
			Promise<{ bytes: Uint8Array|undefined; version: number; }> {
		const { src, version } = await this.getByteSource();
		const bytes = await readBytesFrom(src, start, end);
		return { bytes, version };
	}

	async readTxt(): Promise<{ txt: string; version: number; }> {
		const { bytes, version } = await this.readBytes();
		const txt = (bytes ? utf8.open(bytes) : '');
		return { txt, version };
	}

	async copy(file: File): Promise<number> {
		const { version, sink } = await this.getByteSink();
		const src = (file.v ?
			(await file.v.getByteSource()).src :
			await file.getByteSource());
		await pipe(src, sink);
		return version;
	}

	async readJSON<T>(): Promise<{ json: T; version: number; }> {
		const { txt, version } = await this.readTxt();
		const json = JSON.parse(txt);
		return { json, version };
	}

}
Object.freeze(V.prototype);
Object.freeze(V);

Object.freeze(exports);