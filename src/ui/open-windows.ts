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

import { app, ipcMain } from 'electron';
import { WindowOpener } from './window-opener';
import { StartupWin } from './startup';
import { ClientWin } from './client';

const coreAppNames = [ StartupWin.APP_NAME ];
Object.freeze(coreAppNames);

export class OpenWindows {
	
	private startupDone = false;
	private idToWinMap = new Map<number, WindowOpener>();
	private nameToWinMap = new Map<string, WindowOpener>();
	
	constructor() {
		Object.defineProperty(this, 'idToWinMap', { writable: false });
		Object.defineProperty(this, 'nameToWinMap', { writable: false });
		Object.seal(this);
	}
	
	private registerWin(w: WindowOpener): void {
		let id = w.win.id;
		this.idToWinMap.set(id, w);
		this.nameToWinMap.set(w.name, w);
		w.win.on('closed', () => {
			this.unregisterWin(id);
		});
	}
	
	private unregisterWin(id: number): void {
		let w = this.idToWinMap.get(id);
		if (!w) { return; }
		this.idToWinMap.delete(id);
		this.nameToWinMap.delete(w.name);
	}
	
	getWin<T extends WindowOpener>(appName: string): T {
		return <T> this.nameToWinMap.get(appName);
	}
	
	openStartupWin(): StartupWin {
		let startup = <StartupWin> this.nameToWinMap.get(StartupWin.APP_NAME);
		if (startup) {
			startup.win.focus();
			return startup;
		}
		if (this.startupDone) { throw new Error('Start has already been done.'); }
		startup = new StartupWin();
		this.registerWin(startup);
		this.startupDone = true;
		return startup;
	}
	
	openClientWin(): ClientWin {
		let clientApp = <ClientWin> this.nameToWinMap.get(ClientWin.APP_NAME);
		if (clientApp) {
			clientApp.win.focus();
			return clientApp;
		}
		clientApp = new ClientWin();
		this.registerWin(clientApp);
		return clientApp;
	}
	
}
Object.freeze(OpenWindows.prototype);
Object.freeze(OpenWindows);

Object.freeze(exports);