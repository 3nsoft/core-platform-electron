/*
 Copyright (C) 2018 3NSoft Inc.

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

/// <reference types="jasmine" />

declare namespace appTesting {

	// TODO declare here things, that are used in tests, and are injected into
	// UI tests' global object

	interface SpecIt {
		expectation: string;
		disableIn?: string;
		func?: (...args: any[]) => Promise<void>;
		funcArgs?: string[];
		numOfExpects?: number;
		timeout?: number;
	}

	interface SpecDescribe {
		description: string;
		its: SpecIt[];
		focused?: boolean;
	}

	interface User {
		userId: string;
		pass: string;
	}
	
	interface ClientRunner {
		user: User;
		readonly c: SpectronClient;
		restart(loginUser?: boolean): Promise<void>;
		createUser(userId: string): Promise<User>;
		displayBrowserLogs(): Promise<void>;
		displayStdOutLogs(): Promise<void>;
	}

	// SpectronClient is taken verbatim from spectron.d.ts, cause there is no
	// way to reference this node's module from this standalone definition file.
	interface SpectronClient extends WebdriverIO.Client<void> {
		/**
		 * Wait until the window is no longer loading.
		 * Takes an optional timeout in milliseconds that defaults to 5000.
		 */
		waitUntilWindowLoaded(timeout?:number):Promise<void>;

		/**
		 * Wait until the element matching the given selector contains the given text.
		 * Takes an optional timeout in milliseconds that defaults to 5000.
		 */
		waitUntilTextExists(selector:string, text:string, timeout?:number):Promise<void>;

		/**
		 * Gets the number of open windows. <webview> tags are also counted as separate windows.
		 */
		getWindowCount():Promise<number>;
		/**
		 * Focus a window using its index from the windowHandles() array.
		 * <webview> tags can also be focused as a separate window.
		 */
		windowByIndex(index:number):Promise<void>;
		/**
		 * Get the selected text in the current window.
		 */
		getSelectedText():Promise<string>;
		/**
		 * Gets the console log output from the render process.
		 * The logs are cleared after they are returned.
		 */
		getRenderProcessLogs():Promise<WebdriverIO.LogEntry[]>;
		/**
		 * Gets the console log output from the main process.
		 * The logs are cleared after they are returned.
		 */
		getMainProcessLogs():Promise<string[]>;
	}

	interface Setup {

		app: ClientRunner;
		c: SpectronClient;
	
		signupDomains: string[];
	
		start(): Promise<void>;
		stop(): Promise<void>;
	
		displayBrowserLogs(): Promise<void>;
		displayStdOutLogs(): Promise<void>;
	
	}

	interface MultiUserSetup {

		users: User[];
		apps: Map<string, ClientRunner>;
		c(userId: string): SpectronClient;
	
		signupDomains: string[];
	
		start(): Promise<void>;
		stop(): Promise<void>;
		createUser(userId: string): Promise<User>;
	
		displayBrowserLogs(): Promise<void>;
		displayStdOutLogs(): Promise<void>;
	
	}

}
