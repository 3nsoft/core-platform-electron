/*
 Copyright (C) 2017 - 2018, 2020 - 2021 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

/// <reference path="../../node_modules/core-3nweb-client-lib/build/api-defs/web3n.d.ts" />
/// <reference path="./apps.d.ts" />
/// <reference path="./device.d.ts" />
/// <reference path="./ui.d.ts" />

declare namespace web3n.ui {

	// XXX we should use base definitions from lib.
	// Should we copy type definitions file for SDK use?
	// Should pack task make such copy?

	/**
	 * This is a definition of capabilities' object, injected into the DOM.
	 * One has to ensure that any particular capability is given, before trying
	 * to use it.
	 */
	interface W3N {
		device?: device.Service;
		mail?: asmail.Service;
		storage?: storage.Service;
		mailerid?: mailerid.Service;
		openChildWindow?: OpenChildWindow;
		// parent?: rpc.RPC;
		openViewer?: OpenViewer;
		openWithOSBrowser?: OpenWithOSBrowser;
		openWithOSApp?: OpenWithOSApp;
		log?: Logger;
		closeSelf?: () => void;
		apps?: web3n.ui.Apps;
		logout?: Logout;
	}

	type Logger = (
		type: 'error'|'info'|'warning', msg: string, err?: any
	) => Promise<void>;

	type Logout = (closePlatform: boolean) => Promise<void>;

}
