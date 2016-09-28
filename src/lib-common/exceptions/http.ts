/*
 Copyright (C) 2015 3NSoft Inc.
 
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

/**
 * This module contains some code and type declarations that are common for
 * both main and worker processes.
 */

import { RuntimeException } from './runtime';

export const HTTPExceptionType = 'http-request';
export const ConnectExceptionType = 'http-connect';

export interface ConnectException extends RuntimeException {
	url: string;
	method: string;
	message?: string;
}

export interface HTTPException extends ConnectException {
	status: number;
}

export function makeConnectionException(url: string, method: string,
		msg: string = null): ConnectException {
	let exc: ConnectException = {
		runtimeException: true,
		type: ConnectExceptionType,
		url: url,
		method: method
	};
	if (msg) {
		exc.message = msg;
	}
	return exc;
}

export function makeHTTPException(url: string, method: string, status: number,
		msg: string = null): HTTPException {
	let exc: HTTPException = {
		runtimeException: true,
		type: HTTPExceptionType,
		url: url,
		method: method,
		status: status
	};
	if (msg) {
		exc.message = msg;
	}
	return exc;
}

Object.freeze(exports);