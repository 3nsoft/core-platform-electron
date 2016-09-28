/*
 Copyright (C) 2015 - 2016 3NSoft Inc.
 
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

import { makeHTTPException, makeConnectionException, HTTPException }
	from '../lib-common/exceptions/http';

let xhr2 = require('xhr2');

export const SESSION_ID_HEADER = "X-Session-Id";

export interface JSONHttpRequest extends XMLHttpRequest {
	sendJSON(json: any): void;
}

export interface Reply<T> {
	url: string;
	method: string;
	status: number;
	data: T;
	headers?: Headers;
}

export interface RequestOpts {
	method: string;
	url: string;
	responseType?: 'json' | 'arraybuffer';
	sessionId?: string;
	responseHeaders?: string[];
}

export interface Headers {
	get(name: string): string;
}

let logHttp = (process.argv.indexOf('--console-log-http') > 0);

function makeHeadersInstanceFrom(xhr: XMLHttpRequest, selectHeaders: string[]):
		Headers {
	let m = new Map<string, string>();
	for (let h of selectHeaders) {
		if (typeof h !== 'string') { continue; }
		let value = xhr.getResponseHeader(h);
		if (typeof value !== 'string') { continue; }
		m.set(h.toLowerCase(), value);
	}
	return {
		get(name: string): string {
			return m.get(name.toLowerCase());
		}
	};
}

export function request<T>(contentType: string, opts: RequestOpts):
		{ xhr: XMLHttpRequest; promise: Promise<Reply<T>>; } {
	let xhr: XMLHttpRequest = new xhr2();
	let promise = new Promise<Reply<T>>((resolve, reject) => {
		xhr.open(opts.method, opts.url);
// DEBUG
if (logHttp) { console.log(` - ${opts.method} @ ${opts.url} ...\n`); }
		xhr.onload = () => {
			let data = xhr.response;
// DEBUG
if (logHttp) { console.log(` > ${xhr.status} reply to ${opts.method} @ ${opts.url}\n > ${(data instanceof ArrayBuffer) ? (<ArrayBuffer> data).byteLength+' bytes' : JSON.stringify(data) }\n`); }
			if ((opts.responseType === 'arraybuffer') &&
					(data instanceof ArrayBuffer)) {
				data = new Uint8Array(data);
			}
			let rep: Reply<T> = {
				url: opts.url,
				method: opts.method,
				status: xhr.status,
				data: data
			};
			if (Array.isArray(opts.responseHeaders)) {
				rep.headers = makeHeadersInstanceFrom(xhr, opts.responseHeaders);
			}
			resolve(rep);
		};
		xhr.onerror = (ev) => {
// DEBUG
if (logHttp) { console.log(` * cannot connect to ${opts.method} @ ${opts.url} ...\n${ev}\n`); }
			reject(makeConnectionException(opts.url, opts.method, 'Cannot connect'));
		};
		if (contentType) {
			xhr.setRequestHeader('Content-Type', contentType);
		}
		if (opts.sessionId) {
			xhr.setRequestHeader(SESSION_ID_HEADER, opts.sessionId);
		}
		if (opts.responseType) {
			xhr.responseType = opts.responseType;
		}
	});
	return { xhr, promise };
}

/**
 * This assembles XMLHttpRequest with 'Content-Type: application/json' and
 * sends given json. 
 * @param opts
 * @param json
 * @return a promise, resolvable to reply object
 */
export function doJsonRequest<T>(opts: RequestOpts, json: any):
		Promise<Reply<T>> {
	let req = request<T>('application/json', opts);
	req.xhr.send(JSON.stringify(json));
	return req.promise;
}

/**
 * This assembles XMLHttpRequest with 'Content-Type: application/octet-stream'
 * and sends given bytes.
 * @param opts
 * @param bytes
 * @return a promise, resolvable to reply object
 */
export function doBinaryRequest<T>(opts: RequestOpts, bytes: Uint8Array):
		Promise<Reply<T>> {
	let req = request<T>('application/octet-stream', opts);
	req.xhr.send(bytes);
	return req.promise;
}

/**
 * This assembles XMLHttpRequest with 'Content-Type: text/plain'
 * and sends given text
 * @param opts
 * @param txt
 * @return a promise, resolvable to reply object
 */
export function doTextRequest<T>(opts: RequestOpts, txt: string):
		Promise<Reply<T>> {
	let req = request<T>('text/plain', opts);
	req.xhr.send(txt);
	return req.promise;
}

/**
 * This assembles XMLHttpRequest without 'Content-Type'.
 * @param opts
 * @return a promise, resolvable to reply object
 */
export function doBodylessRequest<T>(opts: RequestOpts): Promise<Reply<T>> {
	let req = request<T>(null, opts);
	req.xhr.send();
	return req.promise;
}

/**
 * @param rep
 * @param errMsg
 * @return http exception based on given reply, with an optional message
 */
export function makeException(rep: Reply<any>, errMsg?: string): HTTPException {
	return makeHTTPException(rep.url, rep.method, rep.status, errMsg);
}

Object.freeze(exports);