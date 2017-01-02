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

/// <reference path="./web3n.d.ts" />

/**
 * This is a namespace for things used by storage and any file functionality.
 */
declare namespace web3n.storage {
	
	interface Service {
		
		getAppLocalFS(appDomain: string): Promise<FS>;
		
		getAppSyncedFS(appDomain: string): Promise<FS>;
		
	}

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

		target<T>(): Promise<T>;
	}
	
	type ListingEntry = web3n.files.ListingEntry;
	type FileException = web3n.files.FileException;
	
	interface FileStats extends web3n.files.FileStats {
		/**
		 * This tells object's version.
		 * If such information cannot be provided, this field will be absent.
		 */
		version: number;
	}

	interface File extends web3n.files.File {

		/**
		 * @return a promise, resolvable to file stats.
		 */
		stat(): Promise<FileStats>;

		/**
		 * @param bytes is a complete file content to write
		 * @return a promise, resolvable to new file's version when file is
		 * written
		 */
		versionedWriteBytes(bytes: Uint8Array): Promise<number>;

		/**
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 * @return a promise, resolvable to either non-empty byte array, or
		 * undefined.
		 */
		versionedReadBytes(start?: number, end?: number):
			Promise<{ bytes: Uint8Array|undefined; version: number; }>;

		/**
		 * @param txt to write to file, using utf8 encoding
		 * @return a promise, resolvable to new file's version when file is
		 * written
		 */
		versionedWriteTxt(txt: string): Promise<number>;

		/**
		 * @return a promise, resolvable to text, read from file, assuming utf8
		 * encoding.
		 */
		versionedReadTxt(): Promise<{ txt: string; version: number; }>;

		/**
		 * @param json
		 * @return a promise, resolvable to new file's version when file is
		 * written
		 */
		versionedWriteJSON(json: any): Promise<number>;

		/**
		 * @return a promise, resolvable to json, read from file
		 */
		versionedReadJSON<T>(): Promise<{ json: T; version: number; }>;

		/**
		 * @return a promise, resolvable to byte sink with seek, and a file
		 * version
		 */
		versionedGetByteSink():
			Promise<{ sink: web3n.ByteSink; version: number; }>;

		/**
		 * @return a promise, resolvable to bytes source with seek, which allows
		 * random reads, and a file version
		 */
		versionedGetByteSource():
			Promise<{ src: web3n.ByteSource; version: number; }>;

		/**
		 * @param file which content will be copied into this file
		 * @return a promise, resolvable to new file's version when copying is
		 * done.
		 */
		versionedCopy(file: web3n.files.File): Promise<number>;

	}

	interface FS extends web3n.files.FS {

		/**
		 * @folder is a path of a root folder.
		 * If folder does not exist, and a writable sub-root is created, then
		 * folder is created. Else, if creating readonly root, folder must exist.
		 * @folderName is an optional name for fs, that defaults to folder's name.
		 * @return a promise, resolvable to a file system object, rooted to a
		 * given folder. If this file system is readonly, returned file system
		 * will also be readonly. 
		 */
		readonlySubRoot(folder: string, folderName?: string): Promise<FS>;

		/**
		 * @folder is a path of a root folder.
		 * If folder does not exist, and a writable sub-root is created, then
		 * folder is created. Else, if creating readonly root, folder must exist.
		 * @folderName is an optional name for fs, that defaults to folder's name.
		 * @return a promise, resolvable to a file system object, rooted to a
		 * given folder. If this file system is readonly, returned file system
		 * will also be readonly. 
		 */
		writableSubRoot(folder: string, folderName?: string): Promise<FS>;

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
		
		/**
		 * @param path of a file
		 * @return a promise, resolvable to file stats.
		 */
		statFile(path: string): Promise<FileStats>;
		
		/**
		 * @param path of a link that should be removed
		 * @return a promise, resolvable when file has been removed
		 */
		deleteLink(path: string): Promise<void>;

		readLink(path: string): Promise<SymLink>;
		
		link(path: string, target: web3n.files.File | web3n.files.FS):
			Promise<void>;
		
		/**
		 * @param path of a file
		 * @return a promise, resolvable to file stats.
		 */
		statFile(path: string): Promise<FileStats>;

		/**
		 * @param path of a folder that should be listed
		 * @return a promise, resolvable to a list of informational objects for
		 * entries in the folder, and a folder's version.
		 */
		versionedListFolder(folder: string):
			Promise<{ lst: ListingEntry[]; version: number; }>;

		/**
		 * @param path of a file to write given json
		 * @param json
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 * @return a promise, resolvable to new file's version when file is
		 * written.
		 */
		versionedWriteJSONFile(path: string, json: any, create?: boolean,
			exclusive?: boolean): Promise<number>;
		
		/**
		 * @param path of a file from which to read json
		 * @return a promise, resolvable to json, read from file, and a version of
		 * file.
		 */
		versionedReadJSONFile<T>(path: string):
			Promise<{ json: T; version: number; }>;
		
		/**
		 * @param path of a file to write given text
		 * @param txt to write to file, using utf8 encoding
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 * @return a promise, resolvable to new file's version when file is
		 * written
		 */
		versionedWriteTxtFile(path: string, txt: string, create?: boolean,
			exclusive?: boolean): Promise<number>;
		
		/**
		 * @param path of a file from which to read text
		 * @return a promise, resolvable to text, read from file, assuming utf8
		 * encoding, and version of file.
		 */
		versionedReadTxtFile(path: string):
			Promise<{ txt: string; version: number; }>;
		
		/**
		 * @param path of a file to write
		 * @param bytes to write to file. This is a whole of file content.
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 * @return a promise, resolvable to new file's version when file is
		 * written
		 */
		versionedWriteBytes(path: string, bytes: Uint8Array, create?: boolean,
			exclusive?: boolean): Promise<number>;
		
		/**
		 * @param path of a file from which to read bytes
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 * @return a promise, resolvable to bytes, that is either non-empty byte
		 * array, or an undefined, and version of file.
		 */
		versionedReadBytes(path: string, start?: number, end?: number):
			Promise<{ bytes: Uint8Array|undefined; version: number; }>;
		
		/**
		 * @param path of a file for which we want to get a writable byte sink
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 * @return a promise, resolvable to byte sink with seek, and a file
		 * version
		 */
		versionedGetByteSink(path: string, create?: boolean, exclusive?: boolean):
			Promise<{ sink: web3n.ByteSink; version: number; }>;
		
		/**
		 * @param path of a file from which to read bytes
		 * @return a promise, resolvable to bytes source with seek, which allows
		 * random reads, and a file version
		 */
		versionedGetByteSource(path: string):
			Promise<{ src: web3n.ByteSource; version: number; }>;

	}
	
}
