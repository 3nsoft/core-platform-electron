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
 * Web3N.Device namespace for things related to a device, like files on a
 * device, etc.
 */
declare namespace Web3N.Device.Files {
	
	interface FileTypeFilter {
		name: string;
		extensions: string[];
	}

	/**
	 * This opens native user dialog for saving file or folder.
	 * @param title is a dialog's title
	 * @param btnLabel is a custom label for the confirmation button. If null is
	 * given, then default label will be used.
	 * @param defaultPath
	 * @param filters is an optional parameter, that provides an array of file
	 * types that can be displayed when you want to limit the user to a specific
	 * type.
	 * @return a promise, resolvable to file object, which should be used to
	 * write file's content.
	 */
	function saveFileDialog(title: string, btnLabel: string,
		defaultPath: string, filters?: FileTypeFilter[]):
		Promise<Web3N.Files.File>;
	
	/**
	 * This opens native user dialog for selecting existing file(s) or folder(s).
	 * @param title is a dialog's title
	 * @param btnLabel is a custom label for the confirmation button. If null is
	 * given, then default label will be used.
	 * @param multiSelections if true, multiple items can be selected. If false,
	 * only one item can be selected.
	 * @param filters is an optional parameter, that provides an array of file
	 * types that can be displayed or selected when you want to limit the user
	 * to a specific type.
	 * @return a promise, resolvable when user closes dialog, returning
	 * file objects, for files selected by user.
	 */
	function openFileDialog(title: string, btnLabel: string,
		multiSelections: boolean, filters?: FileTypeFilter[]):
		Promise<Web3N.Files.File[]>;
	
}