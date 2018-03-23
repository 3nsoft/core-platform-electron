/*
 Copyright (C) 2017 - 2018 3NSoft Inc.

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

import { bind } from '../lib-common/binding';
import { Subject } from 'rxjs';

type FS = web3n.files.FS;
type File = web3n.files.File;
type FSCollection = web3n.files.FSCollection;
type FSItem = web3n.files.FSItem;
type Transferable = web3n.implementation.Transferable;
type AsyncIterator<T> = web3n.AsyncIterator<T>;
type CollectionEvent = web3n.files.CollectionEvent;
type CollectionItemAdditionEvent = web3n.files.CollectionItemAdditionEvent;
type CollectionItemRemovalEvent = web3n.files.CollectionItemRemovalEvent;
type Observer<T> = web3n.Observer<T>;

class FSItemsCollection {

	private items = new Map<string, FSItem>();

	private changesBroadcast = new Subject<CollectionEvent>();
	private change$ = this.changesBroadcast.asObservable();

	async set(name: string, item: FSItem): Promise<void> {
		if (this.items.has(name)) { throw new Error(
			`FS item with name ${name} is already set in this collection.`); }
		this.items.set(name, item);
		this.changesBroadcast.next({
			type: 'entry-addition',
			item,
			path: name,
		});
	}

	async remove(name: string): Promise<boolean> {
		if (!this.items.delete(name)) { return false; }
		this.changesBroadcast.next({
			type: 'entry-removal',
			path: name,
		});
		return true;
	}

	async clear(): Promise<void> {
		this.items.clear();
		this.changesBroadcast.next({
			type: 'entry-removal',
		});
	}

	async get(name: string): Promise<FSItem|undefined> {
		return this.items.get(name);
	}

	async entries(): Promise<AsyncIterator<[ string, FSItem ]>> {
		const iter = this.items.entries();
		const asyncIter: AsyncIterator<[ string, FSItem ]> = {
			next: async () => iter.next()
		};
		(asyncIter as any as Transferable).$_transferrable_type_id_$ = 'SimpleObject';
		return asyncIter;
	}

	async getAll(): Promise<[ string, FSItem ][]> {
		const allItems: [ string, FSItem ][] = [];
		for (const nameAndItem of this.items.entries()) {
			allItems.push(nameAndItem);
		}
		return allItems;
	}

	watch(observer: Observer<CollectionEvent>): () => void {
		const sub = this.change$.subscribe(observer as any);
		return () => sub.unsubscribe();
	}

	wrap(): FSCollection {
		const w: FSCollection = {
			get: bind(this, this.get),
			getAll: bind(this, this.getAll),
			entries: bind(this, this.entries),
			watch: bind(this, this.watch),
			clear: bind(this, this.clear),
			remove: bind(this, this.remove),
			set: bind(this, this.set)
		};
		(w as any as Transferable).$_transferrable_type_id_$ = 'FSCollection';
		return Object.freeze(w);
	}

}
Object.freeze(FSItemsCollection.prototype);
Object.freeze(FSItemsCollection);

export function readonlyWrapFSCollection(c: FSCollection): FSCollection {
	const w: FSCollection = {
		get: c.get,
		getAll: c.getAll,
		entries: c.entries,
		watch: c.watch,
	};
	(w as any as Transferable).$_transferrable_type_id_$ = 'FSCollection';
	return Object.freeze(w);
}

export function makeFSCollection(): FSCollection {
	return (new FSItemsCollection()).wrap();
}

Object.freeze(exports);