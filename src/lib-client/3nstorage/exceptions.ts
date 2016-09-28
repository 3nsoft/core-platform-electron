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

import { RuntimeException, makeRuntimeException }
	from '../../lib-common/exceptions/runtime';

export const StorageExceptionType = 'storage';

export interface StorageException extends RuntimeException {
	objId?: string;
	objNotFound?: boolean;
	objExists?: boolean;
	concurrentTransaction?: boolean;
	unknownObjOrTransaction?: boolean;
	wrongState?: boolean;
}

function makeException(objId: string): StorageException {
	let exc: StorageException = {
		runtimeException: true,
		type: StorageExceptionType,
		objId
	};
	return exc;
}

export function makeObjNotFoundExc(objId: string): StorageException {
	let exc = makeException(objId);
	exc.objNotFound = true;
	return exc;
}

export function makeObjExistsExc(objId: string): StorageException {
	let exc = makeException(objId);
	exc.objExists = true;
	return exc;
}

export function makeConcurrentTransExc(objId: string): StorageException {
	let exc = makeException(objId);
	exc.concurrentTransaction = true;
	return exc;
}

export function makeUnknownObjOrTransExc(objId: string): StorageException {
	let exc = makeException(objId);
	exc.unknownObjOrTransaction = true;
	return exc;
}

export function makeWrongStateExc(objId: string): StorageException {
	let exc = makeException(objId);
	exc.wrongState = true;
	return exc;
}

Object.freeze(exports);