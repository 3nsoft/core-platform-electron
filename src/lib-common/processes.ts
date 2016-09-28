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

export function sleep(millis: number): Promise<void> {
	return new Promise<void>((resolve) => {
		setTimeout(resolve, millis);
	});
}

/**
 * Standard Promise has no finally() method, when all respected libraries do.
 * Inside of an async function one may use try-finally clause. But, when we
 * work with raw promises, we need a compact finalization routine. And this is
 * it for synchronous completion.
 * @param promise
 * @param fin is a synchronous function that performs necessary
 * finalization/cleanup. Use finalizeAsync, when finalization is asynchronous.
 * @return a finalized promise
 */
export function finalize<T>(promise: Promise<T>, fin: () => void): Promise<T> {
	return promise
	.then((res) => {
		fin();
		return res;
	}, (err) => {
		fin();
		throw err;
	})
}

/**
 * Standard Promise has no finally() method, when all respected libraries do.
 * Inside of an async function one may use try-finally clause. But, when we
 * work with raw promises, we need a compact finalization routine. And this is
 * it for an asynchronous completion.
 * @param promise
 * @param fin is an asynchronous function that performs necessary
 * finalization/cleanup. Use finalize, when finalization is synchronous
 * (is not returning promise).
 * @return a finalized promise
 */
export function finalizeAsync<T>(promise: Promise<T>, fin: () => Promise<void>):
		Promise<T> {
	return promise
	.then((res) => {
		return fin()
		.then(() => { return res; });
	}, (err) => {
		return fin()
		.then(() => { throw err; });
	})
}

/**
 * This represents a function that will create a promise, potentially starting
 * some background process, only when it is called. Such wrap of code is needed
 * for scheduling, as very often any start of an action must be postponed till
 * later time. Scheduler needs a not-yet-started activity, as scheduler has
 * control action's start.
 */
export interface Action<T> {
	(): Promise<T>;
}

/**
 * This is a container of processes, labeled by some ids. It allows to track if
 * there is a process already in progress with a given id. And, it allows to
 * chain process, when needed.
 * 
 * Common use of such class is to reuse getting of some expensive resource(s).
 */
export class NamedProcs {
	
	private promises = new Map<string, Promise<any>>();
	
	constructor() {
		Object.freeze(this);
	}
	
	/**
	 * @param id is a string key of a process
	 * @return a promise of a process' completion, or undefined, if process with
	 * given id is unknown.
	 */
	getP<T>(id: string): Promise<T> {
		return this.promises.get(id);
	}
	
	private insertPromise<T>(id: string, promise: Promise<T>): Promise<T> {
		promise = finalize(promise, () => {
			if (this.promises.get(id) === promise) {
				this.promises.delete(id);
			}
		});
		this.promises.set(id, promise);
		return promise;
	}
	
	/**
	 * This method will add a promise of an already started process.
	 * @param id is a string key of a process
	 * @param promise of an already started process
	 * @return a promise of a process' completion.
	 */
	addStarted<T>(id: string, promise: Promise<T>): Promise<T> {
		if (this.promises.has(id)) { throw new Error(
			'Process with id "'+id+'" is already in progress.'); }
		return this.insertPromise(id, promise);
	}
	
	/**
	 * This method will start a given action only, if a process with a given id
	 * is not running.
	 * @param id is a string key of a process
	 * @param action is a function that starts some process
	 * @return a promise of a process' completion.
	 */
	start<T>(id: string, action: Action<T>): Promise<T> {
		if (this.promises.has(id)) { throw new Error(
			'Process with id "'+id+'" is already in progress.'); }
		return this.insertPromise(id, action());
	}
	
	/**
	 * This method will chain a given action to an already running process, or,
	 * if identified process is not running, this will start given action under
	 * a given id.
	 * @param id is a string key of a process
	 * @param action is a function that starts some process
	 * @return a promise of a process' completion.
	 */
	startOrChain<T>(id: string, action: Action<T>): Promise<T> {
		let promise = this.promises.get(id);
		if (promise) {
			let next = promise.then(() => { return action(); });
			return this.insertPromise(id, next);
		} else {
			return this.insertPromise(id, action());
		}
	}
	
}
Object.freeze(NamedProcs.prototype);
Object.freeze(NamedProcs);

/**
 * This is a container of process. It allows to track if a process is already
 * in progress. It also allows to chain process, when needed.
 * 
 * Common use of such class is to reuse getting of some expensive resource, or
 * do ning something as an exclusive process.
 */
export class SingleProc<T> {
	
	private promise: Promise<T> = null;
	
	constructor() {
		Object.seal(this);
	}
	
	private insertPromise(promise: Promise<T>): Promise<T> {
		promise = finalize(promise, () => {
			if (this.promise === promise) {
				this.promise = null;
			}
		});
		this.promise = promise;
		return promise;
	}
	
	getP(): Promise<T> {
		return this.promise;
	}
	
	addStarted(promise: Promise<T>): Promise<T> {
		if (this.promise) { throw new Error('Process is already in progress.'); }
		return this.insertPromise(promise);
	}
	
	start(action: Action<T>): Promise<T> {
		if (this.promise) { throw new Error('Process is already in progress.'); }
		return this.insertPromise(action());
	}
	
	startOrChain(action: Action<T>): Promise<T> {
		if (this.promise) {
			let next = this.promise.then(() => { return action(); });
			return this.insertPromise(next);
		} else {
			return this.insertPromise(action());
		}
	}
	
}
Object.freeze(SingleProc.prototype);
Object.freeze(SingleProc);

function oneTimeCaller(f: () => void): () => void {
	let hasBeenCalled = false;
	return function(): void {
		if (hasBeenCalled) { return; }
		hasBeenCalled = true;
		f();
	}
}

/**
 * Lock allows for exclusive process flow.
 * Locking is done by calling a lock function that returns an unlocker. Unlocker
 * must be called when lock can be released, preferably in a finally clause.
 * @return a lock function.
 * CAUTION: Lock is not re-entrant.
 */
export function makeLock(): () => Promise<() => void> {
	
	let isLocked = false;
	let queue: ((unlock: () => void) => void)[] = [];
	
	function unlock(): void {
		if (queue.length === 0) {
			isLocked = false;
		} else {
			let next = queue.shift();
			next(oneTimeCaller(unlock));
		}
	}
	
	async function lock(): Promise<() => void> {
		if (isLocked) {
			return await new Promise<() => void>((resolve) => {
				queue.push(resolve);
			});
		} else {
			isLocked = true;
			return oneTimeCaller(unlock);
		}
	}
	
	return lock;
}

/**
 * Read-write lock allows reads to occur concurrently, while writes exclude
 * both reads and other writes. Implementation uses fair locking policy.
 * Locking is done by calling proper function that returns an unlocker. Unlocker
 * must be called when lock can be released, preferably in finally clause.
 * CAUTION: Lock is not re-entrant.
 */
export interface ReadWriteLock {
	
	/**
	 * This method acquires lock for reading. This excludes writes, but does
	 * allows other reads, unless they have to be scheduled after an already
	 * waiting write (as per fair policy).
	 * @return a promise, resolvable to unlocking function.
	 */
	lockForRead(): Promise<() => void>;
	
	/**
	 * This method acquires lock for writing. This excludes both reads and other
	 * writes.
	 * @return a promise, resolvable to unlocking function.
	 */
	lockForWrite(): Promise<() => void>;
	
}

/**
 * @return new read-write lock
 */
export function makeReadWriteLock(): ReadWriteLock {
	
	interface Queued {
		isWrite: boolean;
		write?: (unlock: () => void) => void;
		reads?: ((unlock: () => void) => void)[];
	}
	
	let isLockedForWrite = false;
	let isLockedForRead = false;
	let queue: Queued[] = [];
	let readsInProgress = 0;
	
	async function lockForWrite(): Promise<() => void> {
		if (isLockedForRead || isLockedForWrite) {
			return await new Promise<() => void>((resolve) => {
				queue.push({
					isWrite: true,
					write: resolve
				});
			});
		} else {
			isLockedForWrite = true;
			return oneTimeCaller(unlockAfterWrite);
		}
	}
	
	function unlockAfterWrite(): void {
		if (queue.length === 0) {
			isLockedForWrite = false;
			return;
		}
		let next = queue.shift();
		if (next.isWrite) {
			next.write(oneTimeCaller(unlockAfterWrite));
		} else {
			isLockedForWrite = false;
			isLockedForRead = true;
			readsInProgress = next.reads.length;
			for (let read of next.reads) {
				read(oneTimeCaller(unlockAfterRead));
			}
		}
	}
	
	async function lockForRead(): Promise<() => void> {
		if (isLockedForRead) {
			if (queue.length === 0) {
				readsInProgress += 1;
				return oneTimeCaller(unlockAfterRead);
			} else {
				return await queueRead();
			}
		} else if (isLockedForWrite) {
			return await queueRead();
		} else {
			isLockedForRead = true;
			readsInProgress = 1;	// no plus, as it is the first read
			return oneTimeCaller(unlockAfterRead);
		}
	}
	
	async function queueRead():  Promise<() => void> {
		let last = queue[queue.length-1];
		if (!last || last.isWrite) {
			return await new Promise<() => void>((resolve) => {
				queue.push({
					isWrite: false,
					reads: [ resolve ]
				});
			});
		} else {
			return await new Promise<() => void>((resolve) => {
				last.reads.push(resolve);
			});
		}
	}
	
	function unlockAfterRead(): void {
		readsInProgress -= 1;
		if (readsInProgress > 0) { return; }
		if (queue.length === 0) {
			isLockedForRead = false;
			return;
		}
		let next = queue.shift();
		if (next.isWrite) {
			isLockedForWrite = true;
			isLockedForRead = false;
			next.write(oneTimeCaller(unlockAfterWrite));
		} else {
			throw new Error('Read locking is incorrectly queued');
		}
	}
	
	return { lockForRead, lockForWrite };
}

export interface Deferred<T> {
	promise: Promise<T>;
	resolve: (result?: T|PromiseLike<T>) => void;
	reject: (err: any) => void;
}

export function defer<T>(): Deferred<T> {
	let d = <Deferred<T>> {};
	d.promise = new Promise<T>((resolve, reject) => {
		d.resolve = resolve;
		d.reject = reject;
	});
	Object.freeze(d);
	return d;
}

Object.freeze(exports);