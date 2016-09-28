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

/**
 * Throws up if given condition is not true.
 * @param condition is checked to be true
 * @param message is an optional string message
 */
export function assert(condition: boolean, message?: string): void {
	if (!condition) {
		throw new Error('Assertion failure: '+
			(message ? message : 'condition is not satisfied'));
	}
}

Object.freeze(exports);