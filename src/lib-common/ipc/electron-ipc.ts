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

import { ipcMain, ipcRenderer } from 'electron';
import { Duplex } from './generic-ipc';

export { Duplex, RequestEnvelope, RequestHandler, EventEnvelope, EventListener }
	from './generic-ipc';

/**
 * @return a Duplex for communication with a core of a platform that runs in a
 * main process of electron.
 */
export function commToMain(channel: string): Duplex {
	let envListener: (r: any) => void;
	let ipcListener = (event: Electron.IpcRendererEvent, r: any) => {
		if (envListener) { envListener(r); }
	};
	let detach = () => {
		if (!envListener) { return; }
		envListener = (undefined as any);
		ipcRenderer.removeListener(channel, ipcListener);
	};
	return  new Duplex(undefined, {
		postMessage(env: any): void {
			ipcRenderer.send(channel, env);
		},
		addListener(listener: (r: any) => void): () => void {
			if (envListener) { throw new Error(
				'Envelope listener has already been added.'); }
			envListener = listener;
			ipcRenderer.on(channel, ipcListener);
			return detach;
		}
	});
}

/**
 * @return a Duplex for communication with renderer process of a given window.
 */
export function commToRenderer(win: Electron.BrowserWindow, channel: string):
		Duplex {
	let envListener: (r: any) => void;
	let webCont = win.webContents;
	let ipcListener = (event: Electron.IpcMainEvent, r: any) => {
		if (envListener && (event.sender === webCont)) {
			envListener(r);
		}
	};
	let detach = () => {
		if (!envListener) { return; }
		envListener = (undefined as any);
		ipcMain.removeListener(channel, ipcListener);
		webCont = (undefined as any);
	};
	win.on('closed', detach);
	return new Duplex(undefined, {
		postMessage(env: any): void {
			if (!webCont) {
				console.error(
					'Web content is disconnected, and message cannot be sent.');
			} else {
				webCont.send(channel, env);
			}
		},
		addListener(listener: (r: any) => void): () => void {
			if (envListener) { throw new Error(
				'Envelope listener has already been added.'); }
			envListener = listener;
			ipcMain.on(channel, ipcListener);
			return detach;
		}
	});
}

Object.freeze(exports);