/*
 Copyright (C) 2015, 2021 3NSoft Inc.
 
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

import { makeRuntimeException } from "./runtime";

interface HTTPErrorDetails extends web3n.RuntimeException {
	url: string;
	method: string;
	message?: string;
}

export interface ConnectException extends HTTPErrorDetails {
	type: 'http-connect';
}

export interface HTTPException extends HTTPErrorDetails {
	type: 'http-request';
	status: number;
}

export function makeConnectionException(
	url: string|undefined, method: string|undefined, msg?: string, cause?: any
): ConnectException {
	return makeRuntimeException<ConnectException>('http-connect', {
		url, method, cause, message: msg
	}, {});
}

export function makeHTTPException(
	url: string, method: string, status: number, msg?: string, cause?: any
): HTTPException {
	return makeRuntimeException<HTTPException>('http-request', {
		url, method, status, message: msg, cause
	}, {});
}

Object.freeze(exports);