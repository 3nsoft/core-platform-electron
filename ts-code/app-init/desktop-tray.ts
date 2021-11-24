/*
 Copyright (C) 2021 3NSoft Inc.
 
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

import { Tray, Menu } from 'electron';
import { join } from 'path';
import { Observable, Subject } from 'rxjs';


const iconsFolder = ((process.platform === 'win32') ?
	join(__dirname, '..', 'icons', 'windows') :
	((process.platform === 'darwin') ?
		join(__dirname, '../icons/mac') :
		join(__dirname, '../icons/linux')));

const trayIconPath = ((process.platform === 'win32') ?
	join(iconsFolder, '256x256.ico') :
	((process.platform === 'darwin') ?
		join(iconsFolder, '3N.icns') :
		join(iconsFolder, '256x256.png')));

export type TrayItemClick = 'logout' | 'apps-menu' | 'close-all-apps' |
	{ app: string; };

export function createTray(
	userId: string
): { closeTray: () => void; trayEvent$: Observable<TrayItemClick>; } {
	const tray = new Tray(trayIconPath);
	const clicks = new Subject<TrayItemClick>();
	const trayMenu = Menu.buildFromTemplate([
		{
			label: 'Apps Menu',
			click: () => clicks.next('apps-menu')
		},
		// XXX
		// Let's have a list of recent apps here that we get from an observable,
		// updating this menu, instead or in addition of static entries
		{
			label: 'Chat',
			click: () => clicks.next({ app: '3nweb.computer' })
		},
		{
			label: 'Mail',
			click: () => clicks.next({ app: 'mail.3nweb.app' })
		},
		{
			label: 'Storage',
			click: () => clicks.next({ app: 'storage.3nweb.app' })
		},
		{ type: 'separator' },
		{
			label: userId,
			type: 'submenu',
			submenu: [
				{
					label: 'Install and Update Apps',
					click: () => clicks.next({ app: 'apps-installer.3nweb.computer' })
				},
				{
					label: `Close all Apps`,
					click: () => clicks.next('close-all-apps')
				},
				{
					label: `Logout`,
					click: () => clicks.next('logout')
				}
			]
		}
	]);
	tray.setContextMenu(trayMenu);
	let closed = false;
	return {
		trayEvent$: clicks.asObservable(),
		closeTray: () => {
			if (!closed) {
				clicks.complete();
				tray.destroy();
				closed = true;
			}
		}
	};
}


Object.freeze(exports);