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

declare function itAsync(expectation: string,
	assertion?: () => Promise<void>, timeout?: number): void;

declare function xitAsync(expectation: string,
	assertion?: () => Promise<void>, timeout?: number): void;

declare function fitAsync(expectation: string,
	assertion?: () => Promise<void>, timeout?: number): void;

declare function beforeAllAsync(action: () => Promise<void>,
	timeout?: number): void;

declare function afterAllAsync(action: () => Promise<void>,
	timeout?: number): void;

declare function beforeEachAsync(action: () => Promise<void>,
	timeout?: number): void;

declare function afterEachAsync(action: () => Promise<void>,
	timeout?: number): void;
