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


declare namespace Web3N {
	
	interface RuntimeException {
		runtimeException: boolean;
		type?: string;
	}

	/**
	 * This is an input byte stream, in classical lingo.
	 * Its read method provides greater expectation for consumer, than common
	 * streams.
	 * All methods should be usable when called separately from the object, i.e.
	 * all methods must be functions, already bound to some state/closure.
	 */
	interface ByteSource {
		
		// XXX we should add informative method prepareBytes, which sets an
		//		expectation about possible number of bytes that will be read from
		//		this source.
		//		Piped source like decrypting one, may relay respective suggestion to
		//		underlying source.
		//		For sources like file on a disk, it shall be a noop.
		//		This will allow consumer to signal info, which can help upstream
		//		to choose best behaviour, like asking network resource to send bytes
		//		with less of round trips.
		
		/**
		 * @param len is a number of bytes, which should be read from the  source.
		 * If source's end comes earlier, number of returned bytes can be less.
		 * If null is given, all bytes to source end must be returned.
		 * @return a promise of byte array, resolvable when bytes are ready. There
		 * will be less bytes than ordered, when there is no more bytes. 
		 * When the source has already reached its end before this call, promise
		 * resolves to null.
		 */
		read(len: number): Promise<Uint8Array>;
		
		/**
		 * @return total number of bytes that come from this byte source.
		 * Returned value can be null, if a byte source does not know its overall
		 * size, yet.
		 */
		getSize(): Promise<number>;
		
		/**
		 * This method sets an offset for the next read.
		 * One may re-read bytes, by seeking back, or skip bytes, by moving
		 * forward.
		 * The method is optional, and its presence depends on implementation.
		 * @param offset is a new internal pointer position, counting from
		 * stream's absolute beginning. 
		 */
		seek?(offset: number): Promise<void>;

		/**
		 * The method is optional, and it is present when seek method is present.
		 * @return current position in a seekable source.
		 */
		getPosition?(): Promise<number>;
		
	}

	/**
	 * This is an output byte stream, in classical lingo.
	 * Sink sounds simple, as one writes, or dumps bytes into it.
	 * All methods should be usable when called separately from the object, i.e.
	 * all methods must be functions, already bound to some state/closure.
	 */
	interface ByteSink {
		
		/**
		 * @param bytes to be dumped into this sink.
		 * When total size has not been set, or was set as unknown, null must be
		 * given to indicate an end of byte stream.
		 * When size is set, it is an error to give more bytes, or to give null,
		 * before giving all bytes.
		 * @param err is an optional parameter, that pushes error along a pipe if
		 * such is setup.
		 * @return a promise, resolvable when write is done.
		 */
		write(bytes: Uint8Array, err?: any): Promise<void>;

		/**
		 * @return total number of bytes in a bucket where this sink pumps bytes.
		 * Returned value can be null, if a byte sink does not know its overall
		 * size, yet.
		 */
		getSize(): Promise<number>;
		
		/**
		 * This function can be called only once. Other calls will throw exceptions.
		 * @param size is a total number of bytes, that will be dumped into this
		 * sink. If size is null, we explicitly state that size will not be known
		 * till end of stream.
		 * @return a promise, resolvable when total sink size is set.
		 */
		setSize(size: number): Promise<void>;
		
		/**
		 * This method sets an offset for the next write.
		 * One may write bytes at random places, by seeking back to proper position,
		 * together with adjusting total size.
		 * The method is optional, and its presence depends on implementation.
		 * @param offset is a new internal pointer position, counting from sink's
		 * absolute beginning. 
		 */
		seek?(offset: number): Promise<void>;

		/**
		 * The method is optional, and it is present when seek method is present.
		 * @return current position in a seekable sink.
		 */
		getPosition?(): Promise<number>;
	}

}

declare namespace Web3N.Files {
	
	interface FileException extends RuntimeException {
		code: string;
		message?: string;
		notFound?: boolean;
		alreadyExists?: boolean;
		notDirectory?: boolean;
		notFile?: boolean;
		isDirectory?: boolean;
		notEmpty?: boolean;
		endOfFile?: boolean;
	}
	
	interface exceptionCode {
		notFound: string;
		alreadyExists: string;
		notDirectory: string;
		notFile: string;
		isDirectory: string;
		notEmpty: string;
		endOfFile: string;
	}

	interface ListingEntry {
		name: string;
		isFolder?: boolean;
		isFile?: boolean;
	}

	interface FileStats {
		/**
		 * File size in bytes.
		 */
		size: number;
		/**
		 * Last modification time stamp.
		 * If such information cannot be provided, this field will be absent.
		 */
		mtime?: Date;
		/**
		 * This tells object's version.
		 * If such information cannot be provided, this field will be absent.
		 */
		version?: number;
	}

	interface File {
		name: string;
		isNew: boolean;
		version?: number;
		writeJSON?(json: any): Promise<void>;
		readJSON(): Promise<any>;
		writeTxt?(txt: string): Promise<void>;
		readTxt(): Promise<string>;
		getByteSink?(): Promise<ByteSink>;
		getByteSource(): Promise<ByteSource>;
	}

	interface FS {
		
		makeSubRoot(folder: string): Promise<FS>;
		
		/**
		 * @param path of a folder that should be listed
		 * @return a promise, resolvable to a list of informational objects for
		 * entries in the folder. Object contains entry's name and a flag,
		 * indicating entry's type.
		 */
		listFolder(folder: string): Promise<ListingEntry[]>;
			
		/**
		 * @param path of a folder that should be created
		 * @param exclusive is an optional flag, which when set to true, throws
		 * if folder already exists. Default value is false, i.e. if folder
		 * exists, nothing happens.
		 * @return a promise, resolvable when a given folder is created/found.
		 */
		makeFolder(path: string, exclusive?: boolean): Promise<void>;
			
		/**
		 * @param path of a folder that should be removed
		 * @param removeContent is an optional flag, which true values forces
		 * recursive removal of all content in the folder. Default value is false.
		 * If folder is not empty, and content removal flag is not set, then an
		 * error is thrown.
		 * @return a promise, resolvable when folder has been removed
		 */
		deleteFolder(path: string, removeContent?: boolean): Promise<void>;
		
		/**
		 * @param path of a file that should be removed
		 * @return a promise, resolvable when file has been removed
		 */
		deleteFile(path: string): Promise<void>;
		
		/**
		 * @param path of a file to write given json
		 * @param json
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 * @return a promise, resolvable when file is written
		 */
		writeJSONFile(path: string, json: any, create?: boolean,
			exclusive?: boolean): Promise<void>;
		
		/**
		 * @param path of a file from which to read json
		 * @return a promise, resolvable to json, read from file
		 */
		readJSONFile<T>(path: string): Promise<T>;
		
		/**
		 * @param path of a file to write given text
		 * @param txt to write to file, using utf8 encoding
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 * @return a promise, resolvable when file is written
		 */
		writeTxtFile(path: string, txt: string, create?: boolean,
			exclusive?: boolean): Promise<void>;
		
		/**
		 * @param path of a file from which to read text
		 * @return a promise, resolvable to text, read from file, assuming utf8
		 * encoding.
		 */
		readTxtFile(path: string): Promise<string>;
		
		/**
		 * @param path of a file to write
		 * @param bytes to write to file. This is a whole of file content.
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 * @return a promise, resolvable when file is written
		 */
		writeBytes(path: string, bytes: Uint8Array, create?: boolean,
			exclusive?: boolean): Promise<void>;
		
		/**
		 * @param path of a file from which to read bytes
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 * @return a promise, resolvable to byte array.
		 */
		readBytes(path: string, start?: number, end?: number):
			Promise<Uint8Array>;
		
		/**
		 * @param path of a file for which we want to get a writable byte sink
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 * @return a promise, resolvable to byte sink with seek
		 */
		getByteSink(path: string, create?: boolean, exclusive?: boolean):
			Promise<ByteSink>;
		
		/**
		 * @param path of a file from which to read bytes
		 * @return a promise, resolvable to bytes source with seek, which allows
		 * random reads.
		 */
		getByteSource(path: string): Promise<ByteSource>;
	
		/**
		 * @param src is an initial path of a file (or folder)
		 * @param dst is a new path of a file (or folder)
		 * @return a promise, resolvable when file (or folder) has been moved.
		 */
		move(src: string, dst: string): Promise<void>;
		
		/**
		 * @param path of a file
		 * @return a promise, resolvable to file stats.
		 */
		statFile(path: string): Promise<FileStats>;
		
		/**
		 * @param path of a folder, which presence we want to check
		 * @param throwIfMissing is an optional flag, which forces with true value
		 * throwing of an exception, when folder does not exist. Default value is
		 * false.
		 * @return a promise, resolvable to true, if folder exists, and to false,
		 * if folder is not found.
		 */
		checkFolderPresence(path: string, throwIfMissing?: boolean):
			Promise<boolean>;
		
		/**
		 * @param path of a file, which presence we want to check
		 * @param throwIfMissing is an optional flag, which forces with true value
		 * throwing of an exception, when folder does not exist. Default value is
		 * false.
		 * @return a promise, resolvable to true, if file exists, and to false,
		 * if file is not found.
		 */
		checkFilePresence(path: string, throwIfMissing?: boolean):
			Promise<boolean>;
		
		/**
		 * @param path
		 * @return a promise, resolvable to readonly file object.
		 */
		readonlyFile(path: string): Promise<File>;

		/**
		 * @param path
		 * @param create
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 * @return a promise, resolvable to byte sink with seek
		 */
		writableFile(path: string, create?: boolean, exclusive?: boolean):
			Promise<File>;
		
	}

}
