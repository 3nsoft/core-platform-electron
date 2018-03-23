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

import { BytesFIFOBuffer, ByteSink, ByteSource, wrapByteSinkImplementation, wrapByteSourceImplementation } from '../byte-streaming/common';
import { ObjSink, ObjSource, wrapObjSourceImplementation } from './common';
import { SinkBackedObjSource } from './pipe';
import { secret_box as sbox } from 'ecma-nacl';
import { SegmentsWriter, SegmentsReader, LocationInSegment, NONCE_LENGTH,  }
from 'xsp-files';
import { bind } from '../binding';
import { errWithCause } from '../exceptions/error';
import { base64urlSafe } from '../buffer-utils';

/**
 * Use this function when byte array(s) should be encrypted.
 * Function returns an object source that does actual computations.
 * @param bytes is an array of byte arrays with content, and it can be
 * modified after this call, as all encryption is done within this call,
 * and given content array is not used by resultant source over its lifetime.
 * @param segWriter that is used used to encrypt bytes into segments.
 * If it were an existing writer, it should be reset for ingestion of a complete
 * new content. Segments writer can be destroyed after this call, as it is not
 * used by resultant source over its lifetime.
 * @param objVersion
 */
export async function makeObjSourceFromArrays(arrs: Uint8Array|Uint8Array[],
		segWriter: SegmentsWriter): Promise<ObjSource> {
	const buf = new BytesFIFOBuffer();
	if (Array.isArray(arrs)) {
		for (let i=0; i<arrs.length; i+=1) {
			buf.push(arrs[i]);
		}
	} else {
		buf.push(arrs);
	}
	const pipe = new SinkBackedObjSource(segWriter.version);
	segWriter.setContentLength(buf.length);
	pipe.writeHeader(await segWriter.packHeader());
	const sinkForSegs = pipe.segSink;
	const numOfSegments = segWriter.numberOfSegments()!;
	if (numOfSegments > 0) {
		// all segments will have the same length, except the last one, therefore,
		const segContentLen = segWriter.segmentSize(0) - sbox.POLY_LENGTH;
		for (let i=0; i<numOfSegments; i+=1) {
			const content = buf.getBytes(segContentLen, true);
			if (!content) { throw new Error(`Assertion fails. All surrounding code should assure that there are bytes here.`); }
			const enc = await segWriter.packSeg(content, i);
			sinkForSegs.write(enc.seg);
		}
	}
	sinkForSegs.write(null);
	return pipe.getSource();
}

class EncryptingObjSource implements ObjSource, ByteSource {

	private segsSize: number|undefined = undefined;
	private readyBytesBuffer = new BytesFIFOBuffer();
	private segIndex = 0;
	private positionInSegments = 0;
	
	segSrc = wrapByteSourceImplementation(this);

	private constructor(
			private byteSrc: ByteSource,
			private segWriter: SegmentsWriter,
			public version: number) {
		Object.seal(this);
	}

	static async makeFor(byteSrc: ByteSource, segWriter: SegmentsWriter,
			objVersion = 0): Promise<ObjSource> {
		const src = new EncryptingObjSource(byteSrc, segWriter, objVersion);
		if (!segWriter.isEndlessFile()) {
			const contentSize = await byteSrc.getSize();
			if (typeof contentSize !== 'number') { throw new Error(
				`Given segment writer already expects finite content, while given byte source is endless.`); }
			if (segWriter.contentLength() !== contentSize) { throw new Error(
				`Given segment writer already expects content length ${segWriter.contentLength()}, while given byte source has size ${contentSize}.`); }
			src.segsSize = src.segWriter.segmentsLength();
		}
		return wrapObjSourceImplementation(src);
	}

	async readHeader(): Promise<Uint8Array> {
		// set sizes, as a side effect of calling getSize()
		await this.getSize();
		// get header for a known size, or for an undefined length
		const h = await this.segWriter.packHeader();
		return h;
	}

	async getSize(): Promise<number|undefined> {
		if (typeof this.segsSize === 'number') { return this.segsSize; }
		const contentLen = await this.byteSrc.getSize();
		if (typeof contentLen !== 'number') { return; }
		this.segWriter.setContentLength(contentLen);
		this.segsSize = this.segWriter.segmentsLength();
		return this.segsSize;
	}

	private async nextSegment(): Promise<Uint8Array|undefined> {
		if (!this.segWriter.isEndlessFile() &&
				(this.segIndex >= this.segWriter.numberOfSegments()!)) { return; }
		const segContentLen = this.segWriter.segmentSize(this.segIndex) -
			sbox.POLY_LENGTH;
		const content = await this.byteSrc.read(segContentLen);
		if (!content) {
			if (this.segWriter.isEndlessFile()) { return; }
			else { throw new Error('Unexpected end of byte source'); }
		}
		const { seg } = await this.segWriter.packSeg(content, this.segIndex);
		this.segIndex += 1;
		return seg;
	}

	private readReadyBytesFromBuffer(len: number|undefined):
			Uint8Array|undefined {
		const chunk = this.readyBytesBuffer.getBytes(len);
		if (chunk) {
			this.positionInSegments += chunk.length;
		}
		return chunk;
	}

	async read(len: number|undefined): Promise<Uint8Array|undefined> {
		// set sizes, as a side effect of calling getSize()
		await this.getSize();
		
		if (typeof len === 'number') {

			// get bytes from buffer, if there is enough of bytes
			if (this.readyBytesBuffer.length >= len) {
				return this.readReadyBytesFromBuffer(len);
			}

			// prepare next segment(s), placing them into buffer, till there is
			// either enough bytes, or an end of source is reached
			let seg = await this.nextSegment();
			while (seg) {
				this.readyBytesBuffer.push(seg);
				if (this.readyBytesBuffer.length >= len) {
					return this.readReadyBytesFromBuffer(len);
				}
				seg = await this.nextSegment();
			}
			return this.readReadyBytesFromBuffer(undefined);

		} else {

			// get all bytes from source, packing them to segments
			let seg = await this.nextSegment();
			while (seg) {
				this.readyBytesBuffer.push(seg);
				seg = await this.nextSegment();
			}

			// return all bytes
			return this.readReadyBytesFromBuffer(undefined);

		}
	}

	async seek(offset: number): Promise<void> {
		if ((offset < 0) || (!this.segWriter.isEndlessFile() &&
				(offset > this.segWriter.segmentsLength()!))) { throw new Error(
			`Given offset ${offset} is out of bounds.`); }
		if (!this.byteSrc.seek) { throw new Error(`Underlying byte source is not seekable`); }
		
		const delta = offset - this.positionInSegments;

		// do nothing case
		if (delta === 0) { return; }

		// reading from buffer adjusts position in this case, without touching src
		if ((delta > 0) && (delta <= this.readyBytesBuffer.length)) {
			this.readReadyBytesFromBuffer(delta);
			return;
		}

		// calculate offset in terms of segment index, and a relative offset
		const { ind, ofs } = this.positionInSegsToSegIndAndOffset(offset);

		// move all parameters to beginning of ind segment
		this.readyBytesBuffer.clear();
		this.segIndex = ind;
		this.positionInSegments = offset - ofs;
		const srcOffset = this.positionInSegments - 16*ind;
		await this.byteSrc.seek(srcOffset);

		// if relative offset is non-zero, adjust position by reading this bit
		if (ofs > 0) {
			const seg = await this.read(ofs);
			if (!seg) { throw new Error(`Unexpected end of underlying byte source.`); }
		}
	}

	/**
	 * This method translates an overall position in segments' stream to a pair
	 * of segment index (ind) and an offset in this segment (ofs), pointing to
	 * the same byte, as an overall position does.
	 * @param pos is an overall position in segment's stream
	 */
	private positionInSegsToSegIndAndOffset(pos: number):
			{ ind: number; ofs: number; } {
		if (pos === 0) { return { ind: 0, ofs: 0 }; }
		let ind = 0;
		let lenOfSegsToInd = 0;
		const numOfSegs = (this.segWriter.isEndlessFile() ?
			0xffffffff : this.segWriter.numberOfSegments()!);
		while (ind < numOfSegs) {
			const segLen = this.segWriter.segmentSize(ind);
			if (pos > (lenOfSegsToInd + segLen)) {
				lenOfSegsToInd += segLen;
				ind += 1;
				continue;
			}
			const contentToInd = lenOfSegsToInd - 16*ind;
			return { ind, ofs: pos-lenOfSegsToInd };
		}
		throw new Error(`This point should be unreachable.`);
	}

	async getPosition(): Promise<number> {
		return this.positionInSegments;
	}

}
Object.freeze(EncryptingObjSource.prototype);
Object.freeze(EncryptingObjSource);

/**
 * Use this function to encrypt a byte source.
 * Function returns an object source that does actual computations.
 * @param bytes
 * @param segWriter
 * @param objVersion
 */
export function makeObjSourceFromByteSource(bytes: ByteSource,
		segWriter: SegmentsWriter, objVersion?: number): Promise<ObjSource> {
	return EncryptingObjSource.makeFor(bytes, segWriter, objVersion);
}

/**
 * This implementation is a non-seekable sink, that encrypts object from start
 * to end. As such, it cannot deal already existing crypto objects.
 */
class EncryptingByteSink implements ByteSink {

	/**
	 * This is a total size of this sink, directed by segments' writer.
	 * If segments' writer content size is not set, then this is undefined.
	 */
	private totalSize: number|undefined;

	/**
	 * Identifies if total size has been set to value, which is the same 
	 * as segments' writer content size value.
	 */
	private isTotalSizeSet: boolean;

	/**
	 * Indicates if header was already written to object sink.
	 */
	private wasHeaderWritten = false;

	/**
	 * Number of collected via write method bytes.
	 */
	private collectedBytes = 0;

	/**
	 * Identifies if this sink is complete, and no more bytes can be accepted.
	 * Note that completion may occur due to error.
	 */
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
			/**
			 * This is a sink for encrypted bytes.
			 */
			private objSink: ObjSink,
			/**
			 * This is a segment writer, used for encryption.
			 */
			private segsWriter: SegmentsWriter) {
		this.seg = { ind: -1, len: 0 };
		this.advanceSeg();
		const totalSize = this.segsWriter.contentLength();
		if (typeof totalSize === 'number') {
			this.totalSize = totalSize;
			this.isTotalSizeSet = true;
		} else {
			this.totalSize = undefined;
			this.isTotalSizeSet = false;
		}
		Object.seal(this);
	}

	/**
	 * This advances seg field.
	 * If there are no more segments, it will set this sink as completed, but
	 * it won't to a finalizing write(s).
	 * @return true, when there is next segment, and false, otherwise.
	 */
	private advanceSeg(): boolean {
		this.seg.ind += 1;
		if (this.segsWriter.isEndlessFile()) {
			if (this.seg.ind === 0) {
				this.seg.len = this.segsWriter.segmentSize(this.seg.ind) - sbox.POLY_LENGTH;
			}
			return true;
		} else if (this.seg.ind < this.segsWriter.numberOfSegments()!) {
			this.seg.len = this.segsWriter.segmentSize(this.seg.ind) - sbox.POLY_LENGTH;
			return true;
		} else {
			return false;
		}
	}
	
	async write(bytes: Uint8Array|null, err?: any): Promise<void> {
		if (err) {
			if (this.isCompleted) { return; }
			await this.finalizeWrite(err);
			return;
		}
		if (this.isCompleted) {
			if (bytes === null) { return; }
			throw new Error("Completed sink cannot except any more bytes.");
		}
		try {
			if (bytes) {
				if (bytes.length === 0) { return; }
				if ((this.isTotalSizeSet) &&
						(bytes.length > (this.totalSize! - this.collectedBytes))) {
					throw new Error("More bytes given than sink was set to accept.");
				}
				this.contentBuf.push(bytes);
				this.collectedBytes += bytes.length;
			} else {
				if ((this.isTotalSizeSet) &&
						(this.totalSize! > this.collectedBytes)) {
					throw new Error(`Not all bytes were written before closing sink.`);
				}
			}
			await this.encryptExactLengthSegments();
			if (!bytes) {
				await this.encryptLastSegment();
			}
		} catch (err) {
			this.finalizeWrite(err);
			throw err;
		}
	}

	private async encryptExactLengthSegments(): Promise<void> {
		if (this.isCompleted) { return; }
		let segContent = this.contentBuf.getBytes(this.seg.len);
		while (segContent) {
			const { dataLen, seg } = await this.segsWriter.packSeg(
				segContent, this.seg.ind);
			if (dataLen !== segContent.length) { throw new Error(`Not all bytes are encrypted into the segment.`); }
			await this.objSink.segSink.write(seg);
			if (!this.advanceSeg()) {
				await this.finalizeWrite();
				break;
			}
			segContent = this.contentBuf.getBytes(this.seg.len);
		}
	}

	private async encryptLastSegment(): Promise<void> {
		if (this.isCompleted) { return; }
		const segContent = this.contentBuf.getBytes(undefined);
		if (segContent) {
			const { dataLen, seg } = await this.segsWriter.packSeg(
				segContent, this.seg.ind);
			if (dataLen !== segContent.length) { throw new Error(`Not all bytes are encrypted into the last segment.`); }
			await this.objSink.segSink.write(seg);
		}
		await this.finalizeWrite();
	}

	private async finalizeWrite(err?: any): Promise<void> {
		if (this.isCompleted) { return; }
		if (err) {
			await this.objSink.segSink.write(null, err);
			if (!this.wasHeaderWritten) {
				await this.objSink.writeHeader(null, err);
			}
		} else {
			await this.objSink.segSink.write(null);
			if (!this.wasHeaderWritten) {
				if (!this.isTotalSizeSet) {
					this.segsWriter.setContentLength(this.collectedBytes);
				}
				await this.objSink.writeHeader(await this.segsWriter.packHeader());
			}
		}
		this.isCompleted = true;
		this.segsWriter.destroy();
		this.segsWriter = (undefined as any);
	}
	
	async setSize(size: number|undefined): Promise<void> {
		if (this.isTotalSizeSet) {
			throw new Error("Total size has already been set");
		} else if ((typeof size === 'number') && (size < this.collectedBytes)) {
			throw new Error(`Given size is less than number of already collected bytes.`);
		}
		this.isTotalSizeSet = true;
		if (typeof size === 'number') {
			this.totalSize = size;
			this.segsWriter.setContentLength(size);
			const numOfSegs = this.segsWriter.numberOfSegments()!;
			if (this.seg.ind < numOfSegs) {
				this.seg.len = this.segsWriter.segmentSize(this.seg.ind) - sbox.POLY_LENGTH;
			} else {
				await this.finalizeWrite();
				return;
			}
		}
		await this.objSink.writeHeader(await this.segsWriter.packHeader());
		this.wasHeaderWritten = true;
	}

	async getSize(): Promise<number|undefined> {
		if (this.isTotalSizeSet) {
			return this.totalSize!;
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
	protected segsReader: SegmentsReader = (undefined as any);
	/**
	 * When segment position is undefined, end of encrypted source has been
	 * reached. Initial value is set at initialization.
	 */
	protected segPos: LocationInSegment = (undefined as any);
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
	
	async init(
			segReaderGen:(header: Uint8Array) => Promise<SegmentsReader>):
			Promise<void> {
		const header = await this.segs.readHeader()
		.catch((err) => {
			throw errWithCause(err, `Cannot get header from a byte source.`);
		});
		try {
			this.segsReader = await segReaderGen(header);
			if (this.segsReader.isEndlessFile() ||
					(this.segsReader.contentLength()! > 0)) {
				this.segPos = this.segsReader.locationInSegments(this.contentPos);
			}
		} catch (err) {
			throw errWithCause(err, `Cannot open object's header.`);
		}
	}
	
	async read(len: number): Promise<Uint8Array|undefined> {
		const segSrc = this.segs.segSrc;
		while (this.segPos &&
				((typeof len !== 'number') || (this.contentBuf.length < len))) {
			const segBytes = await segSrc.read(this.segPos.seg.len);
			if (segBytes) {
				if ((segBytes.length < this.segPos.seg.len) &&
						!this.segsReader.isEndlessFile()) {
					throw new Error("Unexpected end of byte source: got "+
						segBytes.length+', while expected segment length is '+
						this.segPos.seg.len);
				}
			} else {
				if (this.segsReader.isEndlessFile()) {
					this.segPos = (undefined as any);
					break;
				} else {
					throw new Error(`Unexpected end of byte source: end of file is reached while a segment is expected with length ${this.segPos.seg.len}`);
				}
			}
			try {
				const opened = await this.segsReader.openSeg(segBytes,
					this.segPos.seg.ind);
				if (this.segPos.pos === 0) {
					this.contentBuf.push(opened.data);
				} else {
					this.contentBuf.push(opened.data.subarray(this.segPos.pos));
				}
				if (opened.last) {
					this.segPos = (undefined as any);
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
			} catch (err) {
				throw errWithCause(
					err, `Cannot open segment ${this.segPos.seg.ind}`);
			}
		}
		const chunk = this.contentBuf.getBytes(len, !this.segPos);
		if (chunk) { 
			this.contentPos += chunk.length;
		}
		return chunk;
	}
	
	async getSize(): Promise<number|undefined> {
		return (this.segsReader ? this.segsReader.contentLength() : undefined);
	}
	
}

class SeekableDecryptingByteSource extends DecryptingByteSource {

	constructor(objSrc: ObjSource) {
		super(objSrc);
		if (!objSrc.segSrc.seek) { throw new TypeError(`Given a non-seek-able object source.`); }
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
				(offset > this.segsReader.contentLength()!)) { throw new Error(
			'Given offset '+offset+' is out of bounds.'); }
		this.contentBuf.clear();
		this.contentPos = offset;
		this.segPos = this.segsReader.locationInSegments(this.contentPos);
		await this.segs.segSrc.seek!(this.segPos.seg.start);
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
		segReaderGen: (header: Uint8Array) => Promise<SegmentsReader>):
		Promise<ByteSource> {
	const decr = (src.segSrc.seek ?
		new SeekableDecryptingByteSource(src) :
		new DecryptingByteSource(src));
	await decr.init(segReaderGen);
	return wrapByteSourceImplementation(decr);
}

export function idToHeaderNonce(objId: string): Uint8Array {
	if ((3 * objId.length/4) !== NONCE_LENGTH) { throw new Error(
		`Given object id ${objId} doesn't have expected length`); }
	const nonce = base64urlSafe.open(objId);
	if (nonce.length !== NONCE_LENGTH) { throw new Error(
		`Nonce cannot be extracted from a given object id ${objId}`); }
	return nonce;
}

Object.freeze(exports);