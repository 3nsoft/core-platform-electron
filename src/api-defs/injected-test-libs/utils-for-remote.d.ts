/*
 Copyright (C) 2018 3NSoft Inc.

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

/// <reference path="../spectron-jasmine-testing.d.ts" />

/**
 * This function exits in web page context. It turns a given error into well
 * formated string.
 * @param err 
 */
declare function stringifyErr(err: any): string;

/**
 * This function exists in jasmine's context. It executes a given async
 * function in a given client. This function returns value produced by given
 * function. Return value must be json-ifiable as it is passed from web page
 * context to jasmine's side.
 * @param c 
 * @param fn async function to run in page's context
 * @param args passed to function. Values should be json-ifiable, cause they
 * are sent to web context.
 */
declare function exec<T>(c: appTesting.SpectronClient,
	fn: (...args: any[]) => Promise<T>, ...args: any[]): Promise<T>;

/**
 * This function exists in jasmine's context. It executes a given async
 * function in a given client, and both checks expectations and returns value
 * that is produced by given function. Return value must be json-ifiable as it
 * ]is passed from web page context to jasmine's side.
 * @param c 
 * @param fn async function to run in page's context
 * @param args passed to function. Values should be json-ifiable, cause they
 * are sent to web context.
 * @param numOfExps is an optional number that is compared against total number
 * of expectations envoked during run of the given function.
 */
declare function execExpects<T>(c: appTesting.SpectronClient,
	fn: (...args: any[]) => Promise<T>, args?: any[], numOfExps?: number):
	Promise<T>;
