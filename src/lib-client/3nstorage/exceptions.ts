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

export interface StorageException extends web3n.RuntimeException {
	type: 'storage';
	objId?: string;
	version?: number;
	objNotFound?: boolean;
	objExists?: boolean;
	concurrentTransaction?: boolean;
	unknownTransaction?: boolean;
	versionMismatch?: boolean;
	currentVersion?: number;
}

export function makeObjNotFoundExc(objId: string, version?: number): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		objId, version,
		objNotFound: true
	};
}

export function makeObjExistsExc(objId: string, version?: number): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		objId, version,
		objExists: true
	};
}

export function makeConcurrentTransExc(objId: string): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		objId,
		concurrentTransaction: true
	};
}

export function makeUnknownTransactionExc(objId: string): StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		objId,
		unknownTransaction: true
	};
}

export function makeVersionMismatchExc(objId: string, currentVersion: number):
		StorageException {
	return {
		runtimeException: true,
		type: 'storage',
		objId,
		versionMismatch: true,
		currentVersion
	};
}

Object.freeze(exports);