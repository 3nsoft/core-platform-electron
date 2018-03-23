/*
 Copyright (C) 2016 - 2018 3NSoft Inc.

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


declare namespace web3n {
	
	interface RuntimeException {
		runtimeException: true;
		type?: string;
		cause?: any;
	}

	interface EncryptionException {
		failedCipherVerification: true;
	}

	interface AsyncIterator<T> {
		next(): Promise<IteratorResult<T>>;
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
		 * This returns a promise of byte array, resolvable when bytes are ready.
		 * There will be less bytes than ordered, when there is no more bytes. 
		 * When the source has already reached its end before this call, promise
		 * resolves to undefined.
		 * @param len is a number of bytes, which should be read from the  source.
		 * If source's end comes earlier, number of returned bytes can be less.
		 * If undefined is given, all bytes to source end must be returned.
		 */
		read(len: number|undefined): Promise<Uint8Array|undefined>;
		
		/**
		 * This returns total number of bytes that come from this byte source.
		 * Returned value can be undefined, if a byte source does not know its
		 * overall size, yet.
		 */
		getSize(): Promise<number|undefined>;
		
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
		 * This returns current position in a seekable source.
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
		 * This returns a promise, resolvable when write is done.
		 * @param bytes to be dumped into this sink.
		 * When total size has not been set, or was set as unknown, null must be
		 * given to indicate an end of byte stream.
		 * When size is set, it is an error to give more bytes, or to give null,
		 * before giving all bytes.
		 * @param err is an optional parameter, that pushes error along a pipe if
		 * such is setup.
		 */
		write(bytes: Uint8Array|null, err?: any): Promise<void>;

		/**
		 * This returns total number of bytes in a bucket where this sink pumps
		 * bytes. Returned value can be undefined, if a byte sink does not know
		 * its overall size, yet.
		 */
		getSize(): Promise<number|undefined>;
		
		/**
		 * This function can be called only once. Other calls will throw
		 * exceptions.
		 * It returns a promise, resolvable when total sink size is set.
		 * @param size is a total number of bytes, that will be dumped into this
		 * sink. If size is undefined, we explicitly state that size will not be
		 * known till end of stream.
		 */
		setSize(size: number|undefined): Promise<void>;
		
		/**
		 * This method sets an offset for the next write.
		 * One may write bytes at random places, by seeking back to proper
		 * position, together with adjusting total size.
		 * The method is optional, and its presence depends on implementation.
		 * @param offset is a new internal pointer position, counting from sink's
		 * absolute beginning. 
		 */
		seek?(offset: number): Promise<void>;

		/**
		 * The method is optional, and it is present when seek method is present.
		 * This returns current position in a seekable sink.
		 */
		getPosition?(): Promise<number>;
	}

	interface Observer<T> {
		next?: (value: T) => void;
		error?: (err: any) => void;
		complete?: () => void;
	}

}

declare namespace web3n.files {
	
	interface FileException extends RuntimeException {
		type: 'file';
		code: string|undefined;
		path: string;
		notFound?: true;
		alreadyExists?: true;
		notDirectory?: true;
		notFile?: true;
		notLink?: true;
		isDirectory?: true;
		notEmpty?: true;
		endOfFile?: true;
		inconsistentStateOfFS?: true;
		concurrentUpdate?: true;
		parsingError?: true;
	}
	
	interface exceptionCode {
		notFound: 'ENOENT';
		alreadyExists: 'EEXIST';
		notDirectory: 'ENOTDIR';
		notFile: 'ENOTFILE';
		notLink: 'not-link';
		isDirectory: 'EISDIR';
		notEmpty: 'ENOTEMPTY';
		endOfFile: 'EEOF';
		concurrentUpdate: 'concurrent-update';
		parsingError: 'parsing-error';		
	}

	/**
	 * Instances of this interface are produced by folder listing method(s).
	 */
	interface ListingEntry {
		
		/**
		 * This is name of an entity in its parent folder.
		 */
		name: string;

		/**
		 * When present with true value, it indicates that an entity is a folder.
		 */
		isFolder?: boolean;

		/**
		 * When present with true value, it indicates that an entity is a file.
		 */
		isFile?: boolean;

		/**
		 * When present with true value, it indicates that an entity is a link.
		 */
		isLink?: boolean;
	}

	interface FileStats {
		
		/**
		 * File size in bytes.
		 */
		size: number | undefined;
		
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

	type Linkable = File | FS;

	/**
	 * This is an interface for a symbolic link.
	 * In unix file systems there are both symbolic and hard links. We do not
	 * have hard links here, but we need to highlight that nature of links here
	 * is symbolic. For example, when a target is deleted, symbolic link becomes
	 * broken. 
	 */
	interface SymLink {

		/**
		 * Flag that indicates if access to link's target is readonly (true), or
		 * can be writable (false value).
		 */
		readonly: boolean;

		/**
		 * Indicates with true value if target is a file
		 */
		isFile?: boolean;

		/**
		 * Indicates with true value if target is a folder
		 */
		isFolder?: boolean;

		target(): Promise<Linkable>;
	}

	type File = ReadonlyFile | WritableFile;

	interface ReadonlyFile {

		writable: boolean;

		v?: ReadonlyFileVersionedAPI;

		/**
		 * Is a file name, given by the outside to this file. It may, or may not,
		 * be the same as an actual file name in the file system. It may also be
		 * null.
		 */
		name: string;

		/**
		 * Is a flag that says, whether file existed at the moment of this
		 * object's creation.
		 */
		isNew: boolean;

		/**
		 * This returns a promise, resolvable to file stats.
		 */
		stat(): Promise<FileStats>;

		/**
		 * This returns a promise, resolvable to either non-empty byte array, or
		 * undefined.
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 */
		readBytes(start?: number, end?: number): Promise<Uint8Array|undefined>;

		/**
		 * This returns a promise, resolvable to text, read from file, assuming
		 * utf8 encoding.
		 */
		readTxt(): Promise<string>;

		/**
		 * This returns a promise, resolvable to json, read from file
		 */
		readJSON<T>(): Promise<T>;

		/**
		 * This returns a promise, resolvable to bytes source with seek, which
		 * allows random reads.
		 */
		getByteSource(): Promise<web3n.ByteSource>;

	}

	interface WritableFile extends ReadonlyFile {

		v?: WritableFileVersionedAPI;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param bytes is a complete file content to write
		 */
		writeBytes(bytes: Uint8Array): Promise<void>;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param txt to write to file, using utf8 encoding
		 */
		writeTxt(txt: string): Promise<void>;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param json
		 */
		writeJSON(json: any): Promise<void>;

		/**
		 * This returns a promise, resolvable to byte sink with seek
		 */
		getByteSink(): Promise<web3n.ByteSink>;

		/**
		 * This returns a promise, resolvable when copying is done.
		 * @param file which content will be copied into this file
		 */
		copy(file: File): Promise<void>;

	}

	interface ReadonlyFileVersionedAPI {

		/**
		 * This returns a promise, resolvable to either non-empty byte array, or
		 * undefined.
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 */
		readBytes(start?: number, end?: number):
			Promise<{ bytes: Uint8Array|undefined; version: number; }>;

		/**
		 * This returns a promise, resolvable to text, read from file, assuming
		 * utf8 encoding.
		 */
		readTxt(): Promise<{ txt: string; version: number; }>;

		/**
		 * This returns a promise, resolvable to json, read from file
		 */
		readJSON<T>(): Promise<{ json: T; version: number; }>;

		/**
		 * This returns a promise, resolvable to bytes source with seek, which
		 * allows random reads, and a file version
		 */
		getByteSource(): Promise<{ src: web3n.ByteSource; version: number; }>;

	}

	interface WritableFileVersionedAPI extends ReadonlyFileVersionedAPI {
		
		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param bytes is a complete file content to write
		 */
		writeBytes(bytes: Uint8Array): Promise<number>;

		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param txt to write to file, using utf8 encoding
		 */
		writeTxt(txt: string): Promise<number>;

		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param json
		 */
		writeJSON(json: any): Promise<number>;

		/**
		 * This returns a promise, resolvable to byte sink with seek, and a file
		 * version
		 */
		getByteSink(): Promise<{ sink: web3n.ByteSink; version: number; }>;

		/**
		 * This returns a promise, resolvable to new file's version when copying
		 * is done.
		 * @param file which content will be copied into this file
		 */
		copy(file: File): Promise<number>;
		
	}

	type FSType = 'device' | 'synced' | 'local' | 'share' | 'asmail-msg';

	type FS = ReadonlyFS | WritableFS;

	interface ReadonlyFS {

		type: FSType;

		v?: ReadonlyFSVersionedAPI;
		
		writable: boolean;

		/**
		 * Is a folder name, given by the outside to this file system. It may, or
		 * may not, be the same as an actual folder name. It may also be null.
		 */
		name: string;
		
		/**
		 * This returns a promise, resolvable to true, if folder exists, and to
		 * false, if folder is not found.
		 * @param path of a folder, which presence we want to check
		 * @param throwIfMissing is an optional flag, which forces with true value
		 * throwing of an exception, when folder does not exist. Default value is
		 * false.
		 */
		checkFolderPresence(path: string, throwIfMissing?: boolean):
			Promise<boolean>;
		
		/**
		 * This returns a promise, resolvable to true, if file exists, and to
		 * false, if file is not found.
		 * @param path of a file, which presence we want to check
		 * @param throwIfMissing is an optional flag, which forces with true value
		 * throwing of an exception, when file does not exist. Default value is
		 * false.
		 */
		checkFilePresence(path: string, throwIfMissing?: boolean):
			Promise<boolean>;
		
		/**
		 * This returns a promise, resolvable to true, if link exists, and to
		 * false, if link is not found.
		 * @param path of a link, which presence we want to check
		 * @param throwIfMissing is an optional flag, which forces with true value
		 * throwing of an exception, when link does not exist. Default value is
		 * false.
		 */
		checkLinkPresence(path: string, throwIfMissing?: boolean):
			Promise<boolean>;
		
		/**
		 * @param path of a file
		 * This returns a promise, resolvable to file stats.
		 */
		statFile(path: string): Promise<FileStats>;
		
		readLink(path: string): Promise<SymLink>;
		
		watchFolder(path: string, observer: Observer<FolderEvent>): () => void;

		watchFile(path: string, observer: Observer<FileEvent>): () => void;

		watchTree(path: string, observer: Observer<FolderEvent|FileEvent>):
			() => void;

		close(): Promise<void>;

		/**
		 * This returns a promise, resolvable to a file system object, rooted to a
		 * given folder.
		 * @param folder is a path of a root folder.
		 */
		readonlySubRoot(folder: string): Promise<ReadonlyFS>;
		
		/**
		 * This returns a promise, resolvable to a list of informational objects
		 * for entries in the folder.
		 * @param path of a folder that should be listed
		 */
		listFolder(folder: string): Promise<ListingEntry[]>;
		
		/**
		 * This returns a promise, resolvable to json, read from file
		 * @param path of a file from which to read json
		 */
		readJSONFile<T>(path: string): Promise<T>;
		
		/**
		 * This returns a promise, resolvable to text, read from file, assuming
		 * utf8 encoding.
		 * @param path of a file from which to read text
		 */
		readTxtFile(path: string): Promise<string>;
		
		/**
		 * This returns a promise, resolvable to either non-empty byte array, or
		 * undefined.
		 * @param path of a file from which to read bytes
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 */
		readBytes(path: string, start?: number, end?: number):
			Promise<Uint8Array|undefined>;
		
		/**
		 * This returns a promise, resolvable to bytes source with seek, which
		 * allows random reads.
		 * @param path of a file from which to read bytes
		 */
		getByteSource(path: string): Promise<web3n.ByteSource>;

		/**
		 * This returns a promise, resolvable to readonly file object.
		 * @param path
		 */
		readonlyFile(path: string): Promise<ReadonlyFile>;

		/**
		 * This function selects items inside given path, following given
		 * criteria. It start selection process, which may be long, and returns a
		 * promise, resolvable to items collection into selected items will
		 * eventually be placed, and a completion promise, that resolves when
		 * selection/search process completes.
		 * Note that collection can be watched for changes as they happen.
		 * @param path 
		 * @param criteria 
		 */
		select(path: string, criteria: SelectCriteria):
			Promise<{ items: FSCollection; completion: Promise<void>; }>;

	}

	interface SelectCriteria {
		
		/**
		 * This is a match for name. There are three match types:
		 * pattern, regexp and exact.
		 * 1) Pattern is a common cli search like "*.png" that treats *-symbol as
		 * standing for anything. Search isn't case-sensitive.
		 * When name field is a string, it is assumed to be this pattern type.
		 * 2) Regexp is used directly to make a match.
		 * 3) Exact matches given string exactly to names of fs items.
		 */
		name: string | {
			p: string;
			type: 'pattern' | 'regexp' | 'exact';
		};

		/**
		 * depth number, if present, limits search to folder depth in a file tree.
		 */
		depth?: number;

		/**
		 * type identifies type or types of elements this criteria should match.
		 * If missing, all fs types are considered for further matching.
		 */
		type?: FSItemType | FSItemType[];

		/**
		 * action specifies what happens with items that match given criteria:
		 * include or exclude from search results. Selection with include action
		 * returns only items that match criteria. Selection with exclude action
		 * returns all items that don't match criteria.
		 */
		action: 'include' | 'exclude';
	}

	type FSItemType = 'folder' | 'file' | 'link';

	interface FSItem {
		isFile?: boolean;
		isFolder?: boolean;
		isLink?: boolean;
		isCollection?: boolean;
		item?: FS|File|FSCollection;
		location?: {
			fs: FS;
			path: string;
			storageUse?: storage.StorageUse;
			storageType?: storage.StorageType;
		};
	}
	
	interface FSCollection {
		get(name: string): Promise<FSItem|undefined>;
		getAll(): Promise<[ string, FSItem ][]>;
		entries(): Promise<AsyncIterator<[ string, FSItem ]>>;
		watch(observer: Observer<CollectionEvent>): () => void;
		set?: (name: string, f: FSItem) => Promise<void>;
		remove?: (name: string) => Promise<boolean>;
		clear?: () => Promise<void>;
	}

	interface CollectionItemRemovalEvent {
		type: 'entry-removal';
		path?: string;
	}

	interface CollectionItemAdditionEvent {
		type: 'entry-addition';
		path: string;
		item: FSItem;
	}

	type CollectionEvent = CollectionItemAdditionEvent |
		CollectionItemRemovalEvent;

	interface WritableFS extends ReadonlyFS {
		
		v?: WritableFSVersionedAPI;
		
		/**
		 * This either finds existing, or creates new folder, asynchronously.
		 * @param path of a folder that should be created
		 * @param exclusive is an optional flag, which when set to true, throws
		 * if folder already exists. Default value is false, i.e. if folder
		 * exists, nothing happens.
		 */
		makeFolder(path: string, exclusive?: boolean): Promise<void>;
		
		/**
		 * This returns a promise, resolvable when folder has been removed
		 * @param path of a folder that should be removed
		 * @param removeContent is an optional flag, which true values forces
		 * recursive removal of all content in the folder. Default value is false.
		 * If folder is not empty, and content removal flag is not set, then an
		 * error is thrown.
		 */
		deleteFolder(path: string, removeContent?: boolean): Promise<void>;
		
		/**
		 * This returns a promise, resolvable when file has been removed
		 * @param path of a file that should be removed
		 */
		deleteFile(path: string): Promise<void>;
	
		/**
		 * This returns a promise, resolvable when file (or folder) has been
		 * moved.
		 * @param src is an initial path of a file (or folder)
		 * @param dst is a new path of a file (or folder)
		 */
		move(src: string, dst: string): Promise<void>;
	
		/**
		 * This returns a promise, resolvable when file has been copied.
		 * @param src is an initial path of a file
		 * @param dst is a path of a file
		 * @param overwrite is a flag that with a true value allows
		 * overwrite of existing dst file. Default value is false.
		 */
		copyFile(src: string, dst: string, overwrite?: boolean):
			Promise<void>;
		
		/**
		 * This returns a promise, resolvable when folder has been recursively
		 * copied.
		 * @param src is an initial path of a folder
		 * @param dst is a path of a folder
		 * @param mergeAndOverwrite is a flag that with true value allows
		 * merge into existing folder and files overwriting inside. Default
		 * value is false.
		 */
		copyFolder(src: string, dst: string, mergeAndOverwrite?: boolean):
			Promise<void>;
		
		/**
		 * This returns a promise, resolvable when file has been saved.
		 * @param file is a file to save
		 * @param dst is a path where to save given file
		 * @param overwrite is a flag that with a true value allows
		 * overwrite of existing dst file. Default value is false.
		 */
		saveFile(file: File, dst: string, overwrite?: boolean): Promise<void>;
		
		/**
		 * This returns a promise, resolvable when folder has been recursively
		 * saved.
		 * @param folder is a folder to save
		 * @param dst is a path where to save given folder
		 * @param mergeAndOverwrite is a flag that with true value allows
		 * merge into existing folder and files overwriting inside. Default
		 * value is false.
		 */
		saveFolder(folder: FS, dst: string, mergeAndOverwrite?: boolean):
			Promise<void>;

		/**
		 * This returns a promise, resolvable when file has been removed
		 * @param path of a link that should be removed
		 */
		deleteLink(path: string): Promise<void>;

		link(path: string, target: File | FS): Promise<void>;
		
		/**
		 * This returns a promise, resolvable to a file system object, rooted to a
		 * given folder.
		 * @param folder is a path of a root folder.
		 * @param create is a flag, which, with default value true, allows
		 * creation of sub-root folder, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 */
		writableSubRoot(folder: string, create?: boolean, exclusive?: boolean):
			Promise<WritableFS>;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param path of a file to write given json
		 * @param json
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 */
		writeJSONFile(path: string, json: any, create?: boolean,
			exclusive?: boolean): Promise<void>;
		
		/**
		 * This returns a promise, resolvable when file is written
		 * @param path of a file to write given text
		 * @param txt to write to file, using utf8 encoding
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 */
		writeTxtFile(path: string, txt: string, create?: boolean,
			exclusive?: boolean): Promise<void>;
		
		/**
		 * This returns a promise, resolvable when file is written
		 * @param path of a file to write
		 * @param bytes to write to file. This is a whole of file content.
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 */
		writeBytes(path: string, bytes: Uint8Array, create?: boolean,
			exclusive?: boolean): Promise<void>;
		
		/**
		 * This returns a promise, resolvable to byte sink with seek
		 * @param path of a file for which we want to get a writable byte sink
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 */
		getByteSink(path: string, create?: boolean, exclusive?: boolean):
			Promise<web3n.ByteSink>;

		/**
		 * This returns a promise, resolvable to file object.
		 * @param path
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 */
		writableFile(path: string, create?: boolean, exclusive?: boolean):
			Promise<WritableFile>;
		
	}

	interface ReadonlyFSVersionedAPI {

		/**
		 * This returns a promise, resolvable to a list of informational objects
		 * for entries in the folder, and a folder's version.
		 * @param path of a folder that should be listed
		 */
		listFolder(path: string):
			Promise<{ lst: ListingEntry[]; version: number; }>;
		
		/**
		 * This returns a promise, resolvable to json, read from file, and a
		 * version of file.
		 * @param path of a file from which to read json
		 */
		readJSONFile<T>(path: string): Promise<{ json: T; version: number; }>;
		
		/**
		 * This returns a promise, resolvable to text, read from file, assuming
		 * utf8 encoding, and version of file.
		 * @param path of a file from which to read text
		 */
		readTxtFile(path: string): Promise<{ txt: string; version: number; }>;
		
		/**
		 * This returns a promise, resolvable to bytes, that is either non-empty
		 * byte array, or an undefined, and version of file.
		 * @param path of a file from which to read bytes
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 */
		readBytes(path: string, start?: number, end?: number):
			Promise<{ bytes: Uint8Array|undefined; version: number; }>;
		
		/**
		 * This returns a promise, resolvable to bytes source with seek, which
		 * allows random reads, and a file version
		 * @param path of a file from which to read bytes
		 */
		getByteSource(path: string):
			Promise<{ src: web3n.ByteSource; version: number; }>;

	}

	interface WritableFSVersionedAPI  extends ReadonlyFSVersionedAPI {
		
		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written.
		 * @param path of a file to write given json
		 * @param json
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 */
		writeJSONFile(path: string, json: any, create?: boolean,
			exclusive?: boolean): Promise<number>;
		
		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param path of a file to write given text
		 * @param txt to write to file, using utf8 encoding
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 */
		writeTxtFile(path: string, txt: string, create?: boolean,
			exclusive?: boolean): Promise<number>;
		
		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param path of a file to write
		 * @param bytes to write to file. This is a whole of file content.
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 */
		writeBytes(path: string, bytes: Uint8Array, create?: boolean,
			exclusive?: boolean): Promise<number>;
		
		/**
		 * This returns a promise, resolvable to byte sink with seek, and a file
		 * version
		 * @param path of a file for which we want to get a writable byte sink
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 */
		getByteSink(path: string, create?: boolean, exclusive?: boolean):
			Promise<{ sink: web3n.ByteSink; version: number; }>;

	}

	interface FSEvent {
		type: string;
		path: string;
		isRemote?: boolean;
		newVersion?: number;
	}

	interface RemovedEvent extends FSEvent {
		type: 'removed';
	}

	interface MovedEvent extends FSEvent {
		type: 'moved';
	}

	interface SyncedEvent extends FSEvent {
		type: 'synced';
	}

	interface UnsyncedEvent extends FSEvent {
		type: 'unsynced';
	}

	type FolderEvent = EntryRemovalEvent | EntryAdditionEvent |
		EntryRenamingEvent | RemovedEvent | MovedEvent |
		SyncedEvent | UnsyncedEvent;

	interface EntryRemovalEvent extends FSEvent {
		type: 'entry-removal';
		name: string;
	}

	interface EntryAdditionEvent extends FSEvent {
		type: 'entry-addition';
		entry: ListingEntry;
	}

	interface EntryRenamingEvent extends FSEvent {
		type: 'entry-renaming';
		oldName: string;
		newName: string;
	}

	type FileEvent = FileChangeEvent | RemovedEvent | MovedEvent |
		SyncedEvent | UnsyncedEvent;

	interface FileChangeEvent extends FSEvent {
		type: 'file-change';
	}

}


declare namespace web3n.rpc {

	interface RPC {

		getRemote<TRemote>(name: string): TRemote|undefined;

		getRemoteEventually<TRemote>(name: string): Promise<TRemote>;

		registerLocal<T>(local: T,
			params: ObjectRegistrationParams<T>|FuncRegistrationParams):
			() => void;

		close(): void;

		watchRegistrations(obs: Observer<RegistrationEvent>): () => void;

	}

	interface RegistrationEvent {
		type: 'registration' | 'revocation';
		name?: string;
		remote: any;
	}

	interface ObjectRegistrationParams<T> {
		name?: string;
		fields: 'all-jnc' | {
			[field in keyof T]: 'jnc' | FuncRegistrationParams | 'ref' | 'cRef';
		};
	}

	interface FuncRegistrationParams {
		name?: string;
		/**
		 * args specifies how arguments should be passed.
		 * 'all-jnc' default option means that all arguments are either core's
		 * objects, or are passed as jsons.
		 * Another option is to specify an array that instructs how each argument
		 * should be treated: either jnc, or reference passing with cRef
		 * referencing object on caller's side, and ref referncing object on
		 * service side.
		 * If there are more arguments given, than there are in
		 * this array, they are passed as jnc's (either json or core's object).
		 */
		args?: 'all-jnc' | ('jnc' | 'ref' | 'cRef')[];
			/**
		 * reply specifies how return should be passed.
		 * jnc stands for json or core's object. cRef references object on
		 * caller's side, while ref references object on service's side.
		 */
		reply?: 'jnc' | 'ref' | 'cRef' | 'none';
	}

}
