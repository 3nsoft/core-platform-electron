/*
 Copyright (C) 2017 3NSoft Inc.

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

export interface CAPsMap {
	findRemoteCAP<T>(name: string, local: T): T;
	addCAP<T>(name: string, local: T, remote: T): void;
};

export function makeCAPsMap(): CAPsMap {

	const transCAPsLocalToRemote =
		new WeakMap<any, { name: string; cap: any; }>();

	function findRemoteCAP<T>(name: string, local: T): T {
		const remote = transCAPsLocalToRemote.get(local);
		if (!remote || (remote.name !== name)) { throw new Error(
			`Cannot find remote capability '${name}', corresponding to a given local object`); }
		return remote.cap;
	}

	function addCAP<T>(name: string, local: T, remote: T): void {
		transCAPsLocalToRemote.set(local, { name, cap: remote });
	}
	
	const map: CAPsMap = { findRemoteCAP, addCAP };
	return Object.freeze(map);
}
