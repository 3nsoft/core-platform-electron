/*
 Copyright (C) 2018, 2020 3NSoft Inc.

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

import { sep, dirname, basename } from 'path';
import { makeFileException, Code as excCode } from '../../lib-common/exceptions/file';
import { Descriptor } from './descriptor';
import { WeakCache } from '../../lib-common/weak-cache';

type FS = web3n.files.FS;

export class Descriptors {

	/**
	 * We want to have just one descriptor for each path. Descriptors only with
	 * path come and go, unlike descriptors with numeric descriptors, that are
	 * managed by FUSE. Hence, map with weakly referenced values is appropriate
	 * for map by path.
	 */
	private readonly byPath = new WeakCache<string, Descriptor>();

	/**
	 * FUSE handles long living descriptors by numeric identifiers. Hence, map
	 * by numbers should regular, keeping descriptors by normal references. When
	 * descriptor has no associated numeric identifier, it will be released from
	 * other container(s) according to weak reference(s).
	 */
	private readonly byNum = new Map<number, Descriptor>();

	/**
	 * This counter is used to generate unique numeric identifiers for FUSE.
	 */
	private counter = 1;

	constructor(
		private readonly descriptorFor: (path: string) => Descriptor
	) {
		Object.seal(this);
	}

	private getNextNum(): number {
		while (this.byNum.has(this.counter)) {
			if (this.counter < 0xffffffff) {
				this.counter += 1;
			} else {
				this.counter = 1;
			}
		}
		return this.counter;
	}

	getOrMakeUnnumberedFor(path: string): Descriptor {
		let d = this.byPath.get(path);
		if (!d) {
			d = this.descriptorFor(path);
			this.byPath.set(path, d);
		}
		return d;
	}

	makeNumberedFor(path: string): { d: Descriptor; fd: number; } {
		const d = this.getOrMakeUnnumberedFor(path);
		const fd = this.getNextNum();
		this.byNum.set(fd, d);
		return { d, fd };
	}

	getNumbered(fd: number): Descriptor|undefined {
		return this.byNum.get(fd);
	}

	dropNumbered(fd: number): Descriptor|undefined {
		const d = this.byNum.get(fd);
		if (d) {
			this.byNum.delete(fd);
		}
		return d;
	}

}
Object.freeze(Descriptors.prototype);
Object.freeze(Descriptors);


export class Roots {

	private readonly roots: Map<string, FS>|undefined;
	private readonly devIDs = new WeakMap<FS, number>();
	private lastDevId = Math.round(100000+1000000*Math.random());

	constructor(
		private readonly singleRoot: FS|undefined
	) {
		if (this.singleRoot) {
			this.roots = undefined;
			this.setDevIdFor(this.singleRoot);
		} else {
			this.roots = new Map();
		}
		Object.seal(this);
	}

	private setDevIdFor(root: FS): void {
		this.lastDevId += 1;
		this.devIDs.set(root, this.lastDevId);
	}

	getDevId = (root: FS): number => {
		const id = this.devIDs.get(root);
		if (id === undefined) { throw new Error(`Given root is unknown`); }
		return id;
	};

	readonly descriptorFor = (path: string): Descriptor => {
		if (this.singleRoot) {
			return new Descriptor(
				this.singleRoot,
				(sep === '/') ? path : splitPath(path).join('/'));
		}
		const pathSections = splitPath(path);
		if (pathSections.length === 0) {
			throw makeFileException(excCode.notFound, path);
		}
		const root = this.roots?.get(pathSections[0]);
		if (!root) { throw makeFileException(excCode.notFound, path); }
		path = pathSections.slice(1).join('/');
		return new Descriptor(root, path);
	};

	addRoot(root: FS, name: string): void {
		if (this.singleRoot) { throw new Error(
			`Can't add root fs to this single root fs mount`); }
		if (!!Array.from(this.roots!.entries())
		.find(([ n, r ]) => (r === root) && (n !== name))) { throw new Error(
			`Given root fs is already present under a differen name`); }
		this.roots?.set(name, root);
		this.setDevIdFor(root);
	}

}
Object.freeze(Roots.prototype);
Object.freeze(Roots);

function splitPath(path: string): string[] {
	const sections = [ basename(path) ];
	let dir = dirname(path);
	while (dir !== '.') {
		sections.unshift(basename(dir));
		dir = dirname(path);
	}
	return sections;
}


Object.freeze(exports);