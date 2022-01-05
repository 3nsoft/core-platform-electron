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
import { Subject } from 'rxjs';


const iconsFolder = join(__dirname, '..', 'icons',
	(process.platform === 'win32') ? 'windows' :
		((process.platform === 'darwin') ? 'mac' : 'linux'));

const trayIconPath = join(iconsFolder,
	(process.platform === 'win32') ? '256x256.ico' :
		((process.platform === 'darwin') ? '3N.icns' : '256x256.png'));

export type TrayItemClick = TrayClickOp | TrayClickOpenApp | 'add-user';

export interface TrayClickOp {
	item: 'logout' | 'launcher' | 'close-all-apps';
	userId: string;
}

export interface TrayClickOpenApp {
	app: string;
	userId: string;
}


export class DeskTray {

	private readonly tray: Tray;
	private closed = false;
	private readonly clicks = new Subject<TrayItemClick>();
	readonly event$ = this.clicks.asObservable();

	constructor() {
		this.tray = new Tray(trayIconPath);
		Object.seal(this);
	}

	close(): void {
		if (!this.closed) {
			this.closed = true;
			this.clicks.complete();
			this.tray.destroy();
		}
	}

	updateMenu(users: string[]): void {
		if (this.closed) { return; }
		let menuItems: Electron.MenuItemConstructorOptions[];
		if (users.length === 0) {
			menuItems = this.noUser();
		} else if (users.length === 1) {
			menuItems = this.singleUser(users[0]);
		} else {
			menuItems = this.multiUser(users);
		}
		this.tray.setContextMenu(Menu.buildFromTemplate(menuItems));	
	}

	private noUser(): Electron.MenuItemConstructorOptions[] {
		return this.commonCmdItems();
	}

	private singleUser(userId: string): Electron.MenuItemConstructorOptions[] {
		const { appItems, cmdItems } = this.itemsForUser(userId);
		return [
			...appItems,
			{ type: 'separator' },
			{ label: userId, submenu: cmdItems },
			{ type: 'separator' },
			...this.commonCmdItems()
		];
	}

	private multiUser(users: string[]): Electron.MenuItemConstructorOptions[] {
		const items: Electron.MenuItemConstructorOptions[] = [];
		for (const userId of users) {
			const { appItems, cmdItems } = this.itemsForUser(userId);
			items.push(
				{ label: userId, submenu: [
					...appItems, { type: 'separator' }, ...cmdItems
				] },
				{ type: 'separator' }
			);
		}
		items.push(...this.commonCmdItems());
		return items;
	}

	private itemsForUser(userId: string): {
		appItems: Electron.MenuItemConstructorOptions[];
		cmdItems: Electron.MenuItemConstructorOptions[];
	} {
		const appItems: Electron.MenuItemConstructorOptions[] = [
			{
				label: 'Apps',
				click: () => this.clicks.next({ userId, item: 'launcher' })
			},
			{
				label: 'Chat',
				click: () => this.clicks.next({ userId, app: '3nweb.computer' })
			},
			{
				label: 'Mail',
				click: () => this.clicks.next({ userId, app: 'mail.3nweb.app' })
			},
			{
				label: 'Storage',
				click: () => this.clicks.next({ userId, app: 'storage.3nweb.app' })
			}
		];
		const cmdItems: Electron.MenuItemConstructorOptions[] = [
			{
				label: 'Install and Update Apps',
				click: () => this.clicks.next({
					userId, app: 'apps-installer.3nweb.computer' })
			},
			{
				label: `Close Apps`,
				click: () => this.clicks.next({ userId, item: 'close-all-apps' })
			},
			{
				label: `Logout`,
				click: () => this.clicks.next({ userId, item: 'logout' })
			}
		];
		return { appItems, cmdItems };
	}

	private commonCmdItems(): Electron.MenuItemConstructorOptions[] {
		return [{
			label: `Add account`,
			click: () => this.clicks.next('add-user')
		}];
	}

}
Object.freeze(DeskTray.prototype);
Object.freeze(DeskTray);


Object.freeze(exports);