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
 this program. If not, see <http://www.gnu.org/licenses/>.
*/
 
import { net } from 'electron';
import * as https from 'https';
import { RequestOpts, Reply, ContentType, processRequest, formHttpsReqOpts } from './request-utils';
import { utf8 } from '../lib-common/buffer-utils';
import { BytesFIFOBuffer } from '../lib-common/byte-streaming/bytes-fifo-buffer';
import { makeSessionFor3NComms } from './session';

export { makeException, Reply, RequestOpts, extractIntHeader } from './request-utils';

export interface NetClient {

	/**
	 * This makes a 'Content-Type: application/json' request with given json,
	 * returning a promise, resolvable to reply object.
	 * @param opts
	 * @param json
	 */
	doJsonRequest<T>(opts: RequestOpts, json: any): Promise<Reply<T>>;

	/**
	 * This makes a 'Content-Type: application/octet-stream' request with given
	 * bytes, returning a promise, resolvable to reply object.
	 * @param opts
	 * @param bytes
	 */
	doBinaryRequest<T>(
		opts: RequestOpts, bytes: Uint8Array|Uint8Array[]
	): Promise<Reply<T>>;
	
	/**
	 * This makes a request without body, returning a promise, resolvable to
	 * reply object.
	 * @param opts
	 */
	doBodylessRequest<T>(opts: RequestOpts): Promise<Reply<T>>;
	
}

type NetRequestOpts = https.RequestOptions & {
	session: Electron.Session;
	redirect: 'error';
}

export function makeNetClient(session?: Electron.Session): NetClient {
	if (!session) {
		session = makeSessionFor3NComms();
	}
	const requester = opts => net.request(opts);

	function request<T>(opts: RequestOpts,
			contentType?: ContentType, reqBody?: Uint8Array): Promise<Reply<T>> {
		const netReqOpts = formHttpsReqOpts(opts, contentType) as NetRequestOpts;
		netReqOpts.session = session!;
		netReqOpts.redirect = 'error';
		return processRequest<T>(requester as any, netReqOpts, opts, reqBody);
	}

	const client: NetClient = {
		
		doBinaryRequest<T>(opts: RequestOpts,
				bytes: Uint8Array|Uint8Array[]): Promise<Reply<T>> {
			let reqBody: Uint8Array|undefined;
			if (Array.isArray(bytes)) {
				const fifo = new BytesFIFOBuffer();
				for (const arr of bytes) {
					fifo.push(arr);
				}
				reqBody = fifo.getBytes(undefined);
			} else {
				reqBody = bytes;
			}
			return request<T>(opts, 'application/octet-stream', reqBody);
		},

		doBodylessRequest<T>(opts: RequestOpts): Promise<Reply<T>> {
			return request<T>(opts);
		},

		doJsonRequest<T>(opts: RequestOpts, json: any): Promise<Reply<T>> {
			const reqBody = utf8.pack(JSON.stringify(json));
			return request<T>(opts, 'application/json', reqBody);
		}

	};
	
	return Object.freeze(client);
}

Object.freeze(exports);