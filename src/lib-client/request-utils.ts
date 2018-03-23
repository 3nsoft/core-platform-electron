/*
 Copyright (C) 2015 - 2017 3NSoft Inc.
 
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
import { BytesFIFOBuffer } from '../lib-common/byte-streaming/common';
import * as https from 'https';
import { IncomingMessage, IncomingHttpHeaders, ClientRequest } from 'http';
import { parse as parseUrl } from 'url';
import { Observable, Subject } from 'rxjs';
import { toBuffer, utf8 } from '../lib-common/buffer-utils';
import { defer } from '../lib-common/processes';
import { stringifyErr } from '../lib-common/exceptions/error';

export const SESSION_ID_HEADER = "X-Session-Id";
export const CONTENT_TYPE_HEADER = 'Content-Type';

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
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	url?: string;
	appPath?: string;
	responseType?: 'json' | 'arraybuffer';
	sessionId?: string;
	responseHeaders?: string[];
	timeout?: number;
	timeoutRetries?: number;
}

export interface Headers {
	get(name: string): string|undefined;
}

export type ContentType = 'application/json' |
	'application/octet-stream' | 'text/plain';

export type NetRequester = (opts: https.RequestOptions) => ClientRequest;

function nodeRequest(opts: https.RequestOptions): ClientRequest {
	return https.request(opts);
}

function request<T>(opts: RequestOpts,
		contentType?: ContentType, reqBody?: Uint8Array): Promise<Reply<T>> {
	const httpsOpts = formHttpsReqOpts(opts, contentType, reqBody);
	return processRequest<T>(nodeRequest, httpsOpts, opts, reqBody);
}

const logHttp = (process.argv.indexOf('--console-log-http') > 0);

export async function processRequest<T>(requester: NetRequester,
		httpsOpts: https.RequestOptions, opts: RequestOpts,
		reqBody: Uint8Array|undefined, attempt = 0): Promise<Reply<T>> {
	
	if (logHttp) {
		console.log(` - ${httpsOpts.method} @ ${urlIn(httpsOpts)} ...\n`);
	}
	
	try {
		const req = requester(httpsOpts);
		const resPromise = attachRequestReaders(req, opts);
		req.end(reqBody ? toBuffer(reqBody) : undefined);
		const { res, resBody } = await resPromise;
		const rep = formReply<T>(res, resBody, opts);

		if (logHttp) {
			console.log(` > ${rep.status} reply to ${rep.method} @ ${rep.url}\n > ${(opts.responseType === 'arraybuffer') ? (rep.data as any as ArrayBuffer).byteLength+' bytes' : JSON.stringify(rep.data) }\n`);
		}

		return rep;
	} catch (err) {
		const { isTimeout, canRetry } = isTimeoutErr(err, opts, attempt);
		
		if (isTimeout) {
			if (logHttp) {
				console.log(` * timeout of request to ${httpsOpts.method} @ ${urlIn(httpsOpts)}\n${stringifyErr(err)}\n`);
			}
			if (canRetry) {
				return processRequest<T>(
					requester, httpsOpts, opts, reqBody, attempt + 1);
			} else {
				throw err;
			}
		}
		
		if (logHttp) {
			console.log(` * error occured when making request to ${httpsOpts.method} @ ${urlIn(httpsOpts)}\n${stringifyErr(err)}\n`);
		}
		throw err;
	}
}

export function formHttpsReqOpts(opts: RequestOpts, contentType?: ContentType,
		reqBody?: Uint8Array): https.RequestOptions {
	if (!opts.url) { throw new Error(
		`Cannot send net request, cause url is not set in given options.`); }
	if (reqBody && (opts.method !== 'POST') && (opts.method !== 'PUT')) {
		throw new Error(`Cannot have body in ${opts.method} request.`); }
	const url = parseUrl(opts.url);
	const netReqOpts: https.RequestOptions = {
		protocol: url.protocol,
		method: opts.method,
		hostname: url.hostname,
		port: url.port,
		path: url.path,
		headers: {}
	};
	if (reqBody) {
		netReqOpts.headers!['Content-Length'] = reqBody.length;
	}
	if (contentType) {
		netReqOpts.headers![CONTENT_TYPE_HEADER] = contentType;
	}
	if (opts.sessionId) {
		netReqOpts.headers![SESSION_ID_HEADER] = opts.sessionId;
	}
	return netReqOpts;
}

/**
 * This is timeout in milliseconds before response object appears, which should
 * be right when server sends reply headers.
 */
const DEFAULT_TIMEOUT = 10000;

function attachRequestReaders(clReq: ClientRequest, opts: RequestOpts):
		Promise<{ res: IncomingMessage, resBody: Uint8Array|undefined }> {
	// XXX do something for timeouts, that doesn't break good long connections
	// const timeout = (opts.timeout ? opts.timeout : DEFAULT_TIMEOUT);

	// note that we attach reading of body to response as close as possible to
	// its appearance, so as not to miss any incoming data, which may happen if
	// next tick occurs in between.
	const response$ = Observable.fromEvent(clReq, 'response',
		(res: IncomingMessage) => ({res, resBodyPromise: readAllBytesFrom(res)}))
	.take(1);

	const err$ = Observable.fromEvent<IncomingMessage>(clReq, 'error')
	.map(e => { throw makeConnectionException(
		opts.url, opts.method, 'Cannot connect', e); })
	.takeUntil(response$);
	
	return response$
	.merge(err$)
	.flatMap(async resAndBodyProm => {
		const { res, resBodyPromise } = resAndBodyProm;
		const resBody = await resBodyPromise;
		return { res, resBody };
	}, 1)
	.toPromise()
	.catch((exc: HTTPException) => {
		if (exc.cause === TIMEOUT_FLAG) {
			clReq.abort();
		}
		throw exc;
	});
}

const TIMEOUT_FLAG = 'Request Timeout';

function isTimeoutErr(err: HTTPException, opts: RequestOpts,
		currentAttempt: number): { isTimeout: boolean; canRetry: boolean; } {
	if (err.cause !== TIMEOUT_FLAG) {
		return { isTimeout: false, canRetry :false };
	}
	const maxRetries = (opts.timeoutRetries ? opts.timeoutRetries : 0);
	const canRetry = ((maxRetries - currentAttempt) > 0);
	return { isTimeout: true, canRetry };
}

async function readAllBytesFrom(stream: NodeJS.ReadableStream):
		Promise<Uint8Array|undefined> {
	const buf = new BytesFIFOBuffer();
	const deferred = defer<Uint8Array|undefined>();
	stream.on('error', e => deferred.reject(e));
	stream.on('data', chunk => buf.push(chunk));
	stream.on('end', () => deferred.resolve(buf.getBytes(undefined)));
	const bytes = await deferred.promise;
	stream.removeAllListeners();
	return bytes;
}

const EMPTY_ARR = new Uint8Array(0);

function formReply<T>(res: IncomingMessage, resBody: Uint8Array|undefined,
		reqOpts: RequestOpts): Reply<T> {
	const status = res.statusCode!;
	const resContentType =
		res.headers[CONTENT_TYPE_HEADER.toLowerCase()] as ContentType;
	let data: T = undefined as any;
	if (reqOpts.responseType === 'arraybuffer') {
		data = (resBody ? resBody : EMPTY_ARR) as any;
	} else if (reqOpts.responseType === 'json') {
		try {
			data = (resBody ? JSON.parse(utf8.open(resBody)) : undefined);
		} catch (err) {
			if (resContentType === 'application/json') {
				throw makeHTTPException(reqOpts.url!, reqOpts.method, status,
					`Cannot parse received bytes`, err);
			}
		}
	}
	const rep: Reply<T> = {
		url: reqOpts.url!,
		method: reqOpts.method,
		status,
		data,
		headers: (reqOpts.responseHeaders ?
			makeHeaders(filterHeaders(res.headers, reqOpts.responseHeaders)) :
			undefined)
	};
	return rep;
}

function filterHeaders(resHeaders: IncomingHttpHeaders,
		responseHeaders: string[]): { [h:string]: string; } {
	const filteredHeaders: { [h:string]: string; } = {};
	for (const h of responseHeaders) {
		const hVal = resHeaders[h.toLocaleLowerCase()];
		if (!hVal) { continue; }
		filteredHeaders[h.toLowerCase()] = (Array.isArray(hVal) ?
			hVal.join('\n') : hVal);
	}
	return filteredHeaders;
}

function makeHeaders(headers: { [h:string]: string; }): Headers {
	return {
		get(name: string): string|undefined {
			return headers[name.toLowerCase()];
		}
	};
}

function urlIn(httpsOpts: https.RequestOptions): string {
	return `${httpsOpts.protocol}//${httpsOpts.hostname}${httpsOpts.port ? ':'+httpsOpts.port : ''}${httpsOpts.path}`;
}

/**
 * This makes a 'Content-Type: application/json' request with given json,
 * returning a promise, resolvable to reply object.
 * @param opts
 * @param json
 */
export function doJsonRequest<T>(opts: RequestOpts, json: any):
		Promise<Reply<T>> {
	const reqBody = utf8.pack(JSON.stringify(json));
	return request<T>(opts, 'application/json', reqBody);
}

/**
 * This makes a 'Content-Type: application/octet-stream' request with given
 * bytes, returning a promise, resolvable to reply object.
 * @param opts
 * @param bytes
 */
export function doBinaryRequest<T>(opts: RequestOpts,
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
}

/**
 * This makes a request without body, returning a promise, resolvable to
 * reply object.
 * @param opts
 */
export function doBodylessRequest<T>(opts: RequestOpts): Promise<Reply<T>> {
	return request<T>(opts);
}

/**
 * @param rep
 * @param errMsg
 * @return http exception based on given reply, with an optional message
 */
export function makeException(rep: Reply<any>, errMsg?: string): HTTPException {
	return makeHTTPException(rep.url, rep.method, rep.status, errMsg);
}

export function extractIntHeader(rep: Reply<any>, headerName: string): number {
	const intHeader = parseInt(rep.headers!.get(headerName)!);
	if (isNaN(intHeader)) { throw makeException(rep,
		`Malformed response: header ${headerName} is missing or malformed`); }
	return intHeader;
}

Object.freeze(exports);