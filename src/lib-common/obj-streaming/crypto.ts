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

import { BytesFIFOBuffer, ByteSink, ByteSource, wrapByteSinkImplementation, wrapByteSourceImplementation } from '../byte-streaming/common';
import { ObjSink, ObjSource } from './common';
import { SinkBackedObjSource } from './pipe';
import { secret_box as sbox } from 'ecma-nacl';
import { SegmentsWriter, SegmentsReader, LocationInSegment } from 'xsp-files';
import { bind } from '../binding';

/**
 * @param bytes is an array of byte arrays with content, and it can be
 * modified after this call, as all encryption is done within this call,
 * and given content array is not used by resultant source over its lifetime.
 * @param segWriter that is used used to encrypt bytes into segments.
 * If it were an existing writer, it should be reset for ingestion of a complete
 * new content. Segments writer can be destroyed after this call, as it is not
 * used by resultant source over its lifetime.
 * @param objVersion
 * @return an object byte source
 */
export function makeObjByteSourceFromArrays(arrs: Uint8Array|Uint8Array[],
		segWriter: SegmentsWriter, objVersion: number = null):
		ObjSource {
	let buf = new BytesFIFOBuffer();
	if (Array.isArray(arrs)) {
		for (let i=0; i<arrs.length; i+=1) {
			buf.push(arrs[i]);
		}
	} else {
		buf.push(arrs);
	}
	let pipe = new SinkBackedObjSource();
	if (typeof objVersion === 'number') {
		pipe.setObjVersion(objVersion);
	}
	segWriter.setContentLength(buf.length);
	pipe.writeHeader(segWriter.packHeader());
	let sinkForSegs = pipe.segSink;
	let numOfSegments = segWriter.numberOfSegments();
	if (numOfSegments > 0) {
		// all segments will have the same length, except the last one, therefore,
		let segContentLen = segWriter.segmentSize(0) - sbox.POLY_LENGTH;
		for (let i=0; i<numOfSegments; i+=1) {
			let enc = segWriter.packSeg(buf.getBytes(segContentLen, true), i);
			sinkForSegs.write(enc.seg);
		}
	}
	sinkForSegs.write(null);
	return pipe.getSource();
}

/**
 * This implementation is a non-seekable sink, that encrypts object from start
 * to end. As such, it cannot deal already existing crypto objects.
 */
class EncryptingByteSink implements ByteSink {

	private totalSize: number = null;
	private isTotalSizeSet = false;
	private collectedBytes = 0;
	private isCompleted = false;
	
	/**
	 * Content buffer is used to collect bytes before encrypting a segment.
	 */
	protected contentBuf = new BytesFIFOBuffer();
	
	/**
	 * Info about next coming segment.
	 */
	private seg: {
		/**
		 * Segment index.
		 */
		ind: number;
		/**
		 * Length of content that should be packed into this segment.
		 */
		len: number;
	};
	
	constructor(
			private objSink: ObjSink,
			private segsWriter: SegmentsWriter) {
		this.seg = <any> {};
		this.setSegInfo(0);
		Object.seal(this);
	}

	private setSegInfo(segInd: number = null): void {
		if (segInd === null) {
			segInd = this.seg.ind + 1;
		}
		this.seg.len = this.segsWriter.segmentSize(segInd) - sbox.POLY_LENGTH;
		this.seg.ind = segInd;
	}
	
	private async doLastWrite(err: any): Promise<void> {
		if (err) {
			this.completeOnErr(err);
			return;
		}
		if (this.totalSize === null) {
			this.setSize(this.collectedBytes);
		} else if (this.totalSize < this.collectedBytes) {
			throw new Error(`Stopping bytes at ${this.collectedBytes}, which is sooner than declared total size ${this.totalSize}.`);
		}
		try {
			let segContent = this.contentBuf.getBytes(this.seg.len, true);
			if (segContent) {
				let pack = this.segsWriter.packSeg(segContent, this.seg.ind);
				if (pack.dataLen !== segContent.length) { throw new Error('Not all bytes are encrypted into last segment.') }
				await this.objSink.segSink.write(pack.seg);
			}
			this.setCompleted();
			await this.objSink.segSink.write(null);
		} catch (err) {
			this.completeOnErr(err);
		}
	}

	async write(bytes: Uint8Array, err?: any): Promise<void> {
		if (this.isCompleted) {
			if (bytes === null) { return; }
			throw new Error("Completed sink cannot except any more bytes.");
		}
		if (bytes === null) {
			return this.doLastWrite(err);
		}
		if (bytes.length === 0) { return; }
		if (this.totalSize !== null) {
			let maxBytesExpectation = this.totalSize - this.collectedBytes;
			if (bytes.length >= maxBytesExpectation) {
				this.isCompleted = true;
				if (bytes.length > maxBytesExpectation) {
					throw new Error("More bytes given than sink was set to accept.");
				}
			}
		}
		this.contentBuf.push(bytes);
		this.collectedBytes += bytes.length;
		try {
			let segContent = this.contentBuf.getBytes(this.seg.len);
			if (!segContent) { return; }
			let pack = this.segsWriter.packSeg(segContent, this.seg.ind);
			if (pack.dataLen !== segContent.length) { throw new Error('Not all bytes are encrypted into the segment.') }
			await this.objSink.segSink.write(pack.seg);
			this.setSegInfo();
		} catch (err) {
			this.completeOnErr(err);
		}
	}
	
	private setCompleted(): void {
		this.isCompleted = true;
		this.segsWriter.destroy();
		this.segsWriter = null;
	}
	
	private completeOnErr(err: any): void {
		this.objSink.segSink.write(null, err);
		if (this.totalSize === null) {
			this.objSink.writeHeader(null, err);
		}
		this.setCompleted();
	}
	
	async setSize(size: number): Promise<void> {
		if (this.isTotalSizeSet) {
			throw new Error("Total size has already been set");
		} else if ((size !== null) && (size < this.collectedBytes)) {
			throw new Error("Given size is less than number of "+
				"already collected bytes.");
		}
		this.isTotalSizeSet = true;
		if ('number' === typeof size) {
			this.totalSize = size;
			this.segsWriter.setContentLength(size);
		}
		this.objSink.writeHeader(this.segsWriter.packHeader());
	}

	async getSize(): Promise<number> {
		if (this.isTotalSizeSet) {
			return this.totalSize;
		} else {
			return this.collectedBytes;
		}
	}

}
Object.freeze(EncryptingByteSink.prototype);
Object.freeze(EncryptingByteSink);

/**
 * @param objSink is a sink for encrypted object bytes
 * @param segsWriter that encrypts and packs bytes into object segments
 * @return byte sink, that encrypts and pushes bytes into a given object sink.
 */
export function makeEncryptingByteSink(objSink: ObjSink,
		segsWriter: SegmentsWriter): ByteSink {
	return wrapByteSinkImplementation(
		new EncryptingByteSink(objSink, segsWriter));
}

class DecryptingByteSource implements ByteSource {
	
	protected segs: ObjSource;
	protected segsReader: SegmentsReader = null;
	/**
	 * When segment position is null, end of encrypted source has been reached.
	 * Initial value is set at initialization.
	 */
	protected segPos: LocationInSegment = null;
	/**
	 * Content position refers to an absolute position in unencrypted content.
	 */
	protected contentPos = 0;
	/**
	 * Content buffer is used to collect bytes before giving them as a result of
	 * read. Therefore, first byte in this FIFO buffer must be byte, pointed by
	 * content position field.
	 */
	protected contentBuf = new BytesFIFOBuffer();
	
	constructor(objSrc: ObjSource) {
		this.segs = objSrc;
		Object.seal(this);
	}
	
	async init(segReaderGen:
			(header: Uint8Array) => SegmentsReader): Promise<void> {
		let header = await this.segs.readHeader()
		this.segsReader = segReaderGen(header);
		if (this.segsReader.isEndlessFile() ||
				(this.segsReader.contentLength() > 0)) {
			this.segPos = this.segsReader.locationInSegments(this.contentPos);
		}
	}
	
	async read(len: number): Promise<Uint8Array> {
		let segSrc = this.segs.segSrc;
		while (this.segPos &&
				((typeof len !== 'number') || (this.contentBuf.length < len))) {
			let segBytes = await segSrc.read(this.segPos.seg.len);
			if (segBytes) {
				if (segBytes.length < this.segPos.seg.len) {
					throw new Error("Unexpected end of byte source: got "+
						segBytes.length+', while expected segment length is '+
						this.segPos.seg.len);
				}
			} else {
				if (this.segsReader.isEndlessFile()) {
					this.segPos = null;
					break;
				} else {
					throw new Error("Unexpected end of byte source: end of file is"+ 
						"reached while a segment is expected with length "+
						this.segPos.seg.len);
				}
			}
			let opened = this.segsReader.openSeg(segBytes, this.segPos.seg.ind);
			if (this.segPos.pos === 0) {
				this.contentBuf.push(opened.data);
			} else {
				this.contentBuf.push(opened.data.subarray(this.segPos.pos));
			}
			if (opened.last) {
				this.segPos = null;
			} else {
				this.segPos = {
					pos: 0,
					seg: {
						ind: this.segPos.seg.ind + 1,
						start: this.segPos.seg.start + this.segPos.seg.len,
						len: this.segsReader.segmentSize(this.segPos.seg.ind + 1)
					}
				};
			}
		}
		let chunk = this.contentBuf.getBytes(len, !this.segPos);
		if (!chunk) { return null; }
		this.contentPos += chunk.length;
		return chunk;
	}
	
	async getSize(): Promise<number> {
		return (this.segsReader ? this.segsReader.contentLength() : null);
	}
	
}

class SeekableDecryptingByteSource extends DecryptingByteSource {

	constructor(objSrc: ObjSource) {
		super(objSrc);
	}
	
	async seek(offset: number): Promise<void> {
		if ((typeof offset !== 'number') || (offset < 0)) {
			throw new TypeError(`Illegal offset is given: ${offset}`); }
		if (offset === this.contentPos) { return; }
		if ((offset > this.contentPos) &&
				(this.contentBuf.length >= (offset - this.contentPos))) {
			this.contentBuf.getBytes((offset - this.contentPos));
			this.contentPos = offset;
			return;
		}
		if (!this.segsReader.isEndlessFile() &&
				(offset > this.segsReader.contentLength())) { throw new Error(
			'Given offset '+offset+' is out of bounds.'); }
		this.contentBuf.clear();
		this.contentPos = offset;
		this.segPos = this.segsReader.locationInSegments(this.contentPos);
		await this.segs.segSrc.seek(this.segPos.seg.start);
	}

	async getPosition(): Promise<number> {
		return this.contentPos;
	}

}

/**
 * @param src
 * @param fileKeyDecr is a decryptor to extract file key
 * @return a promise, resolvable to versioned byte source that decrypts bytes
 * from a given object byte source.
 */
export async function makeDecryptedByteSource(src: ObjSource,
		segReaderGen: (header: Uint8Array) => SegmentsReader):
		Promise<ByteSource> {
	let decr = (src.segSrc.seek ?
		new SeekableDecryptingByteSource(src) :
		new DecryptingByteSource(src));
	await decr.init(segReaderGen);
	return wrapByteSourceImplementation(decr);
}

Object.freeze(exports);