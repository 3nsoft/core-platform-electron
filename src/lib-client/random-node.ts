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

import { base64urlSafe } from '../lib-common/buffer-utils';
import { randomBytes } from 'crypto';

export function bytes(numOfBytes: number): Uint8Array {
	return randomBytes(numOfBytes);
}

export function uint8(): number {
	return bytes(1)[0];
}

export function stringOfB64UrlSafeChars(numOfChars: number): string {
	let numOfbytes = 3*(1 + Math.floor(numOfChars/4));
	let byteArr = bytes(numOfbytes);
	return base64urlSafe.pack(byteArr).substring(0, numOfChars);
}

export function stringOfB64Chars(numOfChars: number): string {
	let numOfbytes = 3*(1 + Math.floor(numOfChars/4));
	return randomBytes(numOfbytes).toString('base64', 0, numOfChars);
}

Object.freeze(exports);