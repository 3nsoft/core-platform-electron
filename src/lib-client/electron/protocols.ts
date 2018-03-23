/*
 Copyright (C) 2017 3NSoft Inc.
 
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
 
import { protocol } from 'electron';
import { defer } from '../../lib-common/processes';
import * as path from 'path';
import { parse as parseUrl, Url } from 'url';
import { toBuffer } from '../../lib-common/buffer-utils';
import * as mime from 'mime';
import { logWarning } from '../logging/log-to-file';

export const protoSchemas = {
	W3N_APP: 'w3n-app',
	W3N_FS: 'w3n-fs'
};
Object.freeze(protoSchemas);

/**
 * This sets up our standard protocol schema(s).
 */
export function registerAllProtocolShemas(): void {
	protocol.registerStandardSchemes([
		protoSchemas.W3N_APP,
		protoSchemas.W3N_FS
	]);
}

type FS = web3n.files.FS;

export async function setAppProtocolIn(session: Electron.Session,
		appRoot: string|FS, appDomain: string): Promise<void> {

	const isProtoAlreadySet = await new Promise<boolean>((resolve, reject) => {
		session.protocol.isProtocolHandled(protoSchemas.W3N_APP,
			// current definition doesn't say that callback's argument is boolean
			isHandled => resolve(!!isHandled));
	});
	if (isProtoAlreadySet) { return; }

	const deferred = defer<void>();
	const completionFn = (regErr) => {
		if (regErr) { deferred.reject(regErr); }
		else { deferred.resolve(); }
	};
	if (typeof appRoot === 'string') {
		session.protocol.registerFileProtocol(protoSchemas.W3N_APP,
			makeFileProtocolListenerForAppProto(appRoot, appDomain),
			completionFn);
	} else {
		session.protocol.registerBufferProtocol(protoSchemas.W3N_APP,
			makeBufferProtocolListenerForAppProto(appRoot, appDomain),
			completionFn);
	}
	return deferred.promise;
}

function isGetOK(method: string, url: Url, appDomain: string): boolean {
	if (method.toUpperCase() !== 'GET') { return false; }
	if (url.host !== appDomain) { return false; }
	return true;
}

// current (electron 1.6.11) definition misses number option in callback
type FileProtocolHandler = (request: Electron.RegisterFileProtocolRequest, callback: (filePath?: string) => void) => void;

function makeFileProtocolListenerForAppProto(appRoot: string,
		appDomain: string): FileProtocolHandler {
	return (req, cb) => {
		const url = parseUrl(req.url);
		if (isGetOK(req.method, url, appDomain)) {
			const pathOnDisk = path.join(appRoot, path.normalize(url.pathname!));
			cb(pathOnDisk);
		} else {
			logWarning(`Canceled unexpected ${req.method} request for ${req.url}`);
			// current definition misses number option in callback
			cb(-10 as any);
		}
	}
}

type FileException = web3n.files.FileException;

// current (electron 1.6.11) definition misses number option in callback
type BufferProtocolHandler = (request: Electron.RegisterBufferProtocolRequest,
	callback: (buffer?: Buffer | Electron.MimeTypedBuffer) => void) => void;

function makeBufferProtocolListenerForAppProto(appRoot: FS, appDomain: string):
		BufferProtocolHandler {
	return async (req, cb) => {
		const url = parseUrl(req.url);
		
		let isReqOK = isGetOK(req.method, url, appDomain);
		// url pasing does an encodeURI, that should be undone
		const pathname = decodeURI(url.pathname!);
		if (!isReqOK) {
			logWarning(`Canceled unexpected ${req.method} request for ${req.url}`);
			// current definition misses number option in callback
			cb(-10 as any);
			return;
		}

		const mimeType: string = mime.lookup(pathname);
		try {
			const content = await appRoot.readBytes(pathname);
			cb({
				mimeType,
				data: (content ? toBuffer(content) : new Buffer(0))
			});
		} catch (err) {
			const exc = err as FileException;
			const errNum = ((exc.notFound || exc.notFile) ? -6 : -2);
			cb(errNum as any);
		}
	}
}

function makeBufferProtocolListenerForFsProto(fs: FS, path: string,
		appDomain: 'file'|'folder'): BufferProtocolHandler {
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
			// current definition misses number option in callback
			cb(-10 as any);
			return;
		}
		
		const mimeType: string = mime.lookup(pathname);
		try {
			const content = await fs.readBytes(pathname);
			cb({
				mimeType,
				data: (content ? toBuffer(content) : new Buffer(0))
			});
		} catch (err) {
			const exc = err as FileException;
			const errNum = ((exc.notFound || exc.notFile) ? -6 : -2);
			cb(errNum as any);
		}
	}
}

export async function setFsProtocolIn(session: Electron.Session,
		fs: FS, path: string, appDomain: 'file'|'folder'): Promise<void> {

	const isProtoAlreadySet = await new Promise<boolean>((resolve, reject) => {
		session.protocol.isProtocolHandled(protoSchemas.W3N_FS,
			// current definition doesn't say that callback's argument is boolean
			isHandled => resolve(!!isHandled));
	});
	if (isProtoAlreadySet) { return; }

	const deferred = defer<void>();
	const completionFn = (regErr) => {
		if (regErr) { deferred.reject(regErr); }
		else { deferred.resolve(); }
	};
	session.protocol.registerBufferProtocol(protoSchemas.W3N_FS,
		makeBufferProtocolListenerForFsProto(fs, path, appDomain),
		completionFn);
	return deferred.promise;
}

Object.freeze(exports);