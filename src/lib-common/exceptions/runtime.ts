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

/**
 * This module contains some code and type declarations that are common for
 * both main and worker processes.
 */

export type RuntimeException = web3n.RuntimeException;

export function makeRuntimeException(flag: string, type: string, cause?: any):
		RuntimeException {
	let e: RuntimeException = { runtimeException: true, type, cause };
	e[flag] = true;
	return e;
}

Object.freeze(exports);