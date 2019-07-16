/*
 Copyright (C) 2017, 2019 3NSoft Inc.
 
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

import { BrowserWindow } from 'electron';
import * as shorts from 'electron-localshortcut';
import { homedir } from 'os';
import { join } from 'path';
import { readdir, FileException, readFile } from '../lib-common/async-fs-node';
import { isNumber } from 'util';

const openedDevTools = new WeakSet<BrowserWindow>();

function devTools(): void {
	const win = BrowserWindow.getFocusedWindow();
	if (!win) { return; }
	if (win.webContents.devToolsWebContents) {
		win.webContents.devToolsWebContents.focus();
		return;
	} else if (openedDevTools.has(win)) {
		return;
	}
	const devtools = new BrowserWindow({
		webPreferences: {
			session: win.webContents.session
		}
	});
	win.webContents.setDevToolsWebContents(devtools.webContents);
	win.webContents.openDevTools({ mode: 'detach' });
	const closeDevTools = () => devtools.close();
	win.on('close', closeDevTools);
	devtools.on('close', () => win.removeListener('close', closeDevTools));
	openedDevTools.add(devtools);
}

function refresh(): void {
	const win = BrowserWindow.getFocusedWindow();
	if (!win) { return; }
	win.webContents.reloadIgnoringCache();
}

const isMacOS = process.platform === 'darwin';

export function addDevToolsShortcuts(): void {
	shorts.register(isMacOS ? 'Cmd+Alt+I' : 'Ctrl+Shift+I', devTools);
	shorts.register('F12', devTools);
	shorts.register('CmdOrCtrl+R', refresh);
	shorts.register('F5', refresh);
}

const chromeDevTools = 'chrome-devtools://';
const chromeExtensions = 'chrome-extension://';
export function devToolsExtFilter(url: string): boolean {
	return (url.startsWith(chromeDevTools) || url.startsWith(chromeExtensions));
}

const EXTENSION_NAMES: string[] = [
	'Vue.js', 'Angular', 'ng-inspector', 'Augury', 'Cycle.js'
];

type SemVer = [ number, number, number ];
type ExtensionInfo = {
	hash: string;
	version: SemVer;
	name: string;
	path: string;
};

async function collectExtensionsIn(folder: string):
		Promise<Map<string, ExtensionInfo>> {
	const extHashes = await readdir(folder).catch((exc: FileException) => {
		if (exc.notFound || exc.notDirectory) { return [] as string[]; }
		throw exc;
	});
	const extensions = new Map<string, ExtensionInfo>();
	for (const hash of extHashes) {
		const verFolders = await readdir(join(folder, hash)).catch(() => {});
		if (!verFolders) { continue; }
		const versions = verFolders
		.map(s => ({
			version: s.split('.').map(n => parseInt(n)) as SemVer,
			path: join(folder, hash, s)
		}))
		.filter(v => isSemVer(v.version))
		.sort((a, b) => compareSemVers(a.version, b.version));
		if (versions.length === 0) { continue; }
		const latest = versions[versions.length-1];
		const name = await readExtNameFromManifestIn(latest.path);
		if (!name) { continue; }
		extensions.set(hash, {
			hash, name, path: latest.path, version: latest.version
		});
	}
	return extensions;
}

const MANIFEST_FNAME = 'manifest.json';

async function readExtNameFromManifestIn(path: string):
		Promise<string|undefined> {
	try {
		const str = await readFile(
			join(path, MANIFEST_FNAME), { encoding: 'utf8' });
		const manifest = JSON.parse(str);
		if (typeof manifest.name !== 'string') { return; }
		const useThisExt = !!EXTENSION_NAMES.find(
			ext => (manifest.name as string).startsWith(ext));
		if (useThisExt) {
			return manifest.name as string;
		}
	} catch (err) {}
}

function isSemVer(x: SemVer): boolean {
	if (x.length !== 3) { return false; }
	for (const n of x) {
		if (!isNumber(n)) { return false; }
	}
	return true;
}

function compareSemVers(fst: SemVer, snd: SemVer): number {
	for (let i=0; i<3; i+=1) {
		if (fst[i] > snd[i]) {
			return 1;
		} else if (fst[i] < snd[i]) {
			return -1;
		}
	}
	return 0;
}

export async function loadUserExtensions(): Promise<void> {

	let extensions: Map<string, ExtensionInfo>;
	if (process.platform === 'win32') {
		extensions = await collectExtensionsIn(
			`${process.env.LOCALAPPDATA!}\\Google\\Chrome\\User Data\\Default\\Extensions`);
	} else if (process.platform === 'darwin') {
		extensions = await collectExtensionsIn(join(
			homedir(), 'Library/Application Support/Google/Chrome/Default/Extensions'));
	} else {
		if (process.platform !== 'linux') {
			console.log(`Looking for extensions in folder like we are on linux`);
		}
		const locations = [
			'.config/chromium/Default/Extensions/',
			'.config/google-chrome/Default/Extensions/',
			'.config/google-chrome-beta/Default/Extensions/',
			'.config/google-chrome-canary/Default/Extensions/'
		];
		extensions = await collectExtensionsIn(join(homedir(), locations[0]));
		for (let i=1; i<locations.length; i+=1) {
			const exts = await collectExtensionsIn(join(homedir(), locations[i]));
			for (const ext of exts.values()) {
				const otherExt = extensions.get(ext.hash);
				if (!otherExt
				|| (compareSemVers(ext.version, otherExt.version) > 0)) {
					extensions.set(ext.hash, ext);
				}
			}
		}
	}

	if (extensions.size === 0) {
		console.log(`No dev-tools extensions found.`);
		return;
	}

	for (const ext of extensions.values()) {
		console.log(`Loading extension '${ext.name}' from folder ${ext.path}`);
		BrowserWindow.addDevToolsExtension(ext.path);
	}
}

Object.freeze(exports);