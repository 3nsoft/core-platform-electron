/*
 Copyright (C) 2017 - 2021 3NSoft Inc.
 
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
 
import { protocol, CustomScheme } from 'electron';
import { parse as parseUrl, Url } from 'url';
import { toBuffer, EMPTY_BUFFER } from '../lib-common/buffer-utils';
import * as mime from 'mime';
import { logWarning } from '../confs';

export const protoSchemas = {
	W3N_APP: {
		scheme: 'w3n-app',
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			allowServiceWorkers: true,
		}
	} as CustomScheme,
	W3N_FS: {
		scheme: 'w3n-fs',
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true
		}
	} as CustomScheme
};
Object.freeze(protoSchemas);

/**
 * This sets up our standard protocol schema(s).
 */
export function registerAllProtocolShemas(): void {
	protocol.registerSchemesAsPrivileged([
		protoSchemas.W3N_APP,
		protoSchemas.W3N_FS
	]);
}

type FS = web3n.files.FS;

export function setAppProtocolIn(
	session: Electron.Session, appRoot: FS, appDomain: string
): void {
	if (session.protocol.isProtocolRegistered(protoSchemas.W3N_APP.scheme)) {
		return;
	}
	const registered = session.protocol.registerBufferProtocol(
		protoSchemas.W3N_APP.scheme,
		makeBufferProtocolListenerForAppProto(appRoot, appDomain));
	if (!registered) { throw new Error(`Fail to register protocol`); }
}

function isGetOK(method: string, url: Url, appDomain: string): boolean {
	if (method.toUpperCase() !== 'GET') { return false; }
	if (url.host !== appDomain) { return false; }
	return true;
}

type FileException = web3n.files.FileException;

type BufferProtocolHandler = (
	request: Electron.ProtocolRequest,
	callback: (buffer: Buffer | Electron.ProtocolResponse) => void
) => void;

function makeBufferProtocolListenerForAppProto(
	appRoot: FS, appDomain: string
): BufferProtocolHandler {
	return async (req, cb) => {
		const url = parseUrl(req.url);
		
		let isReqOK = isGetOK(req.method, url, appDomain);
		// url pasing does an encodeURI, that should be undone
		const pathname = decodeURI(url.pathname!);
		if (!isReqOK) {
			logWarning(`Canceled unexpected ${req.method} request for ${req.url}`);
			cb({ error: -10 });
			return;
		}

		const mimeType: string = mime.lookup(pathname);
		try {
			const content = await appRoot.readBytes(pathname);
			cb({
				mimeType,
				data: (content ? toBuffer(content) : EMPTY_BUFFER)
			});
		} catch (err) {
			const exc = err as FileException;
			const errNum = ((exc.notFound || exc.notFile) ? -6 : -2);
			cb({ error: errNum });
		}
	}
}

function makeBufferProtocolListenerForFsProto(
	fs: FS, path: string, appDomain: 'file'|'folder'
): BufferProtocolHandler {
	if ((appDomain !== 'file') && (appDomain !== 'folder')) { throw new Error(
		`Domain for fs protocol can either be 'file' or 'folder', but not ${appDomain}`); }
	if (appDomain === 'folder') {
		if (!path.endsWith('/')) {
			path += '/';
		}
	}

	return async (req, cb) => {
		const url = parseUrl(req.url);

		let isReqOK = isGetOK(req.method, url, appDomain);
		// url pasing does an encodeURI, that should be undone
		const pathname = decodeURI(url.pathname!);
		if (appDomain === 'file') {
			isReqOK = isReqOK && (pathname === path);
		} else if (appDomain === 'folder') {
			isReqOK = isReqOK && pathname.startsWith(path);
		}
		if (!isReqOK) {
			logWarning(`Canceled unexpected ${req.method} request for ${req.url}`);
			cb({ error: -10 });
			return;
		}
		
		const mimeType: string = mime.lookup(pathname);
		try {
			const content = await fs.readBytes(pathname);
			cb({
				mimeType,
				data: (content ? toBuffer(content) : EMPTY_BUFFER)
			});
		} catch (err) {
			const exc = err as FileException;
			const errNum = ((exc.notFound || exc.notFile) ? -6 : -2);
			cb({ error: errNum });
		}
	}
}

export function setFsProtocolIn(
	session: Electron.Session, fs: FS, path: string, appDomain: 'file'|'folder'
): void {
	if (session.protocol.isProtocolRegistered(protoSchemas.W3N_FS.scheme)) {
		return;
	}

	// XXX should we make a streaming protocol?

	const registered = session.protocol.registerBufferProtocol(
		protoSchemas.W3N_FS.scheme,
		makeBufferProtocolListenerForFsProto(fs, path, appDomain));
	if (!registered) { throw new Error(`Fail to register protocol`); }
}

Object.freeze(exports);