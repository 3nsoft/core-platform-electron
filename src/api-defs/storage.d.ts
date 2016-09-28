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
declare namespace Web3N.Storage {
	
	interface Service {
		
		getAppFS(appDomain: string): Promise<Storage.FS>;
		
	}
	
	interface FS extends Web3N.Files.FS {
		
		close(): Promise<void>;
		
		makeSubRoot(folder: string): Promise<Storage.FS>;
	
	}
	
}
