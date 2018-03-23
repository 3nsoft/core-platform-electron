/*
 Copyright (C) 2017 - 2018 3NSoft Inc.

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
/// <reference path="./asmail.d.ts" />
/// <reference path="./storage.d.ts" />
/// <reference path="./device.d.ts" />
/// <reference path="./ui.d.ts" />
/// <reference path="./startup.d.ts" />

declare namespace web3n.ui {

	/**
	 * This is a definition of capabilities' object, injected into the DOM.
	 * One has ensure that any particular capability is given, before trying to
	 * use it.
	 */
	interface W3N {
		device?: {
			openFileDialog: device.files.OpenFileDialog;
			openFolderDialog: device.files.OpenFolderDialog;
			saveFileDialog: device.files.SaveFileDialog;
			saveFolderDialog: device.files.SaveFolderDialog;
		};
		mail?: asmail.Service;
		storage?: storage.Service;
		openChildWindow?: OpenChildWindow;
		parent?: rpc.RPC;
		openViewer?: OpenViewer;
		openWithOSApp?: OpenWithOSApp;
		log?: Logger;
		closeSelf?: () => void;
	}

	type Logger = (type: 'error'|'info'|'warning',
		msg: string, err?: any) => Promise<void>;

}