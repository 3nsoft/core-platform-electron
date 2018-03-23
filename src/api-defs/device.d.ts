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

/// <reference path="./web3n.d.ts" />

/**
 * Web3N.Device namespace for things related to a device, like files on a
 * device, etc.
 */
declare namespace web3n.device.files {
	
	interface FileTypeFilter {
		name: string;
		extensions: string[];
	}

	/**
	 * This opens native user dialog for saving file, returning a promise,
	 * resolvable to file object, which should be used to write file's content.
	 * Undefined is returned, when user chose nothing.
	 * @param title is a dialog's title
	 * @param btnLabel is a custom label for the confirmation button. If null is
	 * given, then default label will be used.
	 * @param defaultPath
	 * @param filters is an optional parameter, that provides an array of file
	 * types that can be displayed when you want to limit the user to a specific
	 * type.
	 */
	type SaveFileDialog = (title: string, btnLabel: string,
		defaultPath: string, filters?: FileTypeFilter[]) =>
		Promise<web3n.files.WritableFile | undefined>;

	/**
	 * This opens native user dialog for saving folder, returning a promise,
	 * resolvable to folder object, which should be used to write folder's
	 * content.
	 * Undefined is returned, when user chose nothing.
	 * @param title is a dialog's title
	 * @param btnLabel is a custom label for the confirmation button. If null is
	 * given, then default label will be used.
	 * @param defaultPath
	 * @param filters is an optional parameter, that provides an array of file
	 * types that can be displayed when you want to limit the user to a specific
	 * type.
	 */
	type SaveFolderDialog = (title: string, btnLabel: string,
		defaultPath: string, filters?: FileTypeFilter[]) =>
		Promise<web3n.files.WritableFS | undefined>;
	
	/**
	 * This opens native user dialog for selecting existing file(s), returning
	 * a promise, resolvable when to file objects selected by user.
	 * Undefined is returned, when user chose nothing.
	 * @param title is a dialog's title
	 * @param btnLabel is a custom label for the confirmation button. If null is
	 * given, then default label will be used.
	 * @param multiSelections if true, multiple items can be selected. If false,
	 * only one item can be selected.
	 * @param filters is an optional parameter, that provides an array of file
	 * types that can be displayed or selected when you want to limit the user
	 * to a specific type.
	 */
	type OpenFileDialog = (title: string, btnLabel: string,
		multiSelections: boolean, filters?: FileTypeFilter[]) =>
		Promise<web3n.files.ReadonlyFile[] | undefined>;
	
	/**
	 * This opens native user dialog for selecting existing folder(s), returning
	 * a promise, resolvable when to folder objects selected by user.
	 * Undefined is returned, when user chose nothing.
	 * @param title is a dialog's title
	 * @param btnLabel is a custom label for the confirmation button. If null is
	 * given, then default label will be used.
	 * @param multiSelections if true, multiple items can be selected. If false,
	 * only one item can be selected.
	 * @param filters is an optional parameter, that provides an array of file
	 * types that can be displayed or selected when you want to limit the user
	 * to a specific type.
	 */
	type OpenFolderDialog = (title: string, btnLabel: string,
		multiSelections: boolean, filters?: FileTypeFilter[]) =>
		Promise<web3n.files.WritableFS[] | undefined>;

}