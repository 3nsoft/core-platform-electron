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

import { stringifyErr } from '../../lib-common/exceptions/error';

type RuntimeException = web3n.RuntimeException;

/**
 * This function wraps promise that comes from remote.
 * Remote's rmi mechanism strongly synchronizes execution of callback, given to
 * remote. This may allow script to lockup core, which is not good. Promise
 * takes callbacks on then, and raw promise from remote may expose this
 * vulnerability. Hence, we need to async callbacks that are actually given to
 * remote promise.
 * @param remotePromise promise object from remote side 
 * @param resultWrap is an optional wrap for result of the promise. If not given
 * json copy of remote result is returned. Not providing remote object directly
 * ensures that corresponding remote object reference will be dropped.
 */
function wrapRemotePromise<T>(remotePromise: Promise<T>,
		resultWrap?: Wrap<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		remotePromise.then(
			remoteValue => setTimeout(() => {
				const localValue = (resultWrap ?
					resultWrap(remoteValue) : wrapRemote(remoteValue));
				resolve(localValue);
			}),
			remoteError => setTimeout(() => {
				const localErr = localizeError(remoteError);
				reject(localErr);
			}));
	});
}

function localizeError(error: any): any {
	if ((error as RuntimeException).runtimeException) {
		return wrapLocal(error);
	} else {
		return new Error('Error occured in core:\n'+stringifyErr(error));
	}
}

export type Observer<T> = web3n.Observer<T>;

export function wrapLocalObserver<T>(localObserver: Observer<T>,
		wrapEvent?: Wrap<T>): Observer<T> {
	const remoteObserver: Observer<T> = {};
	const remoteEvents: T[] = [];
	let done: { err?: any };
	let localObservationScheduled = false;
	const scheduleLocalObservation = (): void => {
		if (localObservationScheduled
		|| !localObserver
		|| ((remoteEvents.length === 0) && !done)) {
			return;
		}
		localObservationScheduled = true;
		setTimeout(observeLocally);
	};
	const observeLocally = () => {
		if (remoteEvents.length > 0) {
			const remoteEvent = remoteEvents.shift()!;
			if (localObserver.next) {
				const localEvent = (wrapEvent ?
					wrapEvent(remoteEvent) : wrapRemote(remoteEvent));
				localObserver.next(localEvent);
			}
		} else if (done) {
			if (done.err && localObserver.error) {
				localObserver.error(localizeError(done.err));
			} else if (!done.err && localObserver.complete) {
				localObserver.complete();
			}
			done = (undefined as any);
			localObserver = (undefined as any);
		}
		localObservationScheduled = false;
		scheduleLocalObservation();
	};
	if (localObserver.next) {
		remoteObserver.next = value => {
			remoteEvents.push(value);
			scheduleLocalObservation();
		};
	}
	if (localObserver.complete) {
		remoteObserver.complete = () => {
			done = {};
			scheduleLocalObservation();
		};
	}
	if (localObserver.error) {
		remoteObserver.error = error => {
			done = { err: error };
			scheduleLocalObservation();
		};
	}
	return remoteObserver;
}

export type Wrap<T> = (o: T) => T;
export type ArgWraps = (Wrap<any>|undefined|null)[];

export function wrapRemoteFunc<FnT extends Function>(remoteFn: FnT,
		argWraps?: ArgWraps|null, resultWrap?: Wrap<any>): FnT {
	return function(...args: any[]): Promise<any> {
		if (args.length === 0) {
			return wrapRemotePromise<any>(remoteFn(), resultWrap);
		} else {
			const wrappedArgs = wrapFuncArgs(args, argWraps);
			return wrapRemotePromise<any>(remoteFn(...wrappedArgs), resultWrap);
		}
	} as any as FnT;
}

function wrapFuncArgs(args: any[], argWraps: ArgWraps|undefined|null): any[] {
	const wrappedArgs = new Array<any>(args.length);
	if (argWraps) {
		for (let i=0; i<args.length; i+=1) {
			const wrapFn = argWraps[i];
			wrappedArgs[i] = (wrapFn ? wrapFn(args[i]) : wrapLocal(args[i]));
		}
	} else {
		for (let i=0; i<args.length; i+=1) {
			wrappedArgs[i] = wrapLocal(args[i]);
		}
	}
	return wrappedArgs;
}

export type Listener = (...args: any[]) => void;

export function wrapLocalListener(cb: Listener): Listener {
	const remoteCalls: any[][] = [];
	let localCallScheduled = false;
	const scheduleLocalCall = () => {
		if (localCallScheduled || (remoteCalls.length === 0)) { return; }
		localCallScheduled = true;
		setTimeout(callLocally);
	};
	const callLocally = () => {
		const args = remoteCalls.shift();
		if (!args) { return; }
		if (args.length === 0) {
			cb();
		} else {
			const wrappedArgs = new Array<any>(args.length);
			for (let i=0; i<args.length; i+=1) {
				wrappedArgs[i] = wrapRemote(args[i]);
			}
			cb(...wrappedArgs);
		}
		localCallScheduled = false;
		scheduleLocalCall();
	};
	return function(...args: any[]): void {
		remoteCalls.push(args);
		scheduleLocalCall();
	};
}

type Transferable = web3n.implementation.Transferable;

export function wrapLocal<T>(local: T): T {
	const origType = typeof local;
	if (origType !== 'object') {
		return ((origType !== 'function') ? local : (undefined as any));
	}
	if (local === null) { return (null as any); }
	if (ArrayBuffer.isView(local) || Buffer.isBuffer(local)) {
		return (local as any);
	}

	const rem = findTransferableRemote(local);
	if (rem) { return rem; }

	if (Array.isArray(local)) {
		const arr: any[] = local;
		const c: any[] = [];
		for (let i=0; i < arr.length; i+=1) {
			c[i] = wrapLocal(arr[i]);
		}
		return (c as any);
	}

	const c = ({} as T);
	for (const f of Object.keys(local)) {
		c[f] = wrapLocal<any>(local[f]);
	}

	// object originating from in renderer, i.e. local object, cannot have
	//	indicator of a transferrable type
	if ((c as any as Transferable).$_transferrable_type_id_$) {
		delete (c as any as Transferable).$_transferrable_type_id_$;
	}

	return c;
}

const localToRemote = new WeakMap<any, any>();

export function findTransferableRemote<T>(local: T): T {
	return localToRemote.get(local);
}

export function isObjectFromCore(local: any): boolean {
	return localToRemote.has(local);
}

function registerTransferable<T>(local: T, remote: T): void {
	localToRemote.set(local, remote);
}

export function wrapRemote<T>(rem: T): T {
	const origType = typeof rem;
	if (origType !== 'object') {
		return ((origType !== 'function') ? rem : (undefined as any));
	}
	if (rem === null) { return (null as any); }
	if (Buffer.isBuffer(rem)) {
		return (new Uint8Array(rem)) as any;
	}
	if (ArrayBuffer.isView(rem)) {
		return (rem as any);
	}

	if ((rem as any as Transferable).$_transferrable_type_id_$) {
		const local = wrapTransferrable(rem);
		if (local) { return local; }
	}

	if (Array.isArray(rem)) {
		const arr: any[] = rem;
		const c: any[] = [];
		for (let i=0; i < arr.length; i+=1) {
			c[i] = wrapRemote(arr[i]);
		}
		return (c as any);
	}

	const c = ({} as T);
	for (const f of Object.keys(rem)) {
		c[f] = wrapRemote<any>(rem[f]);
	}

	// indicator of a transferrable type is not needed in a local copy
	if ((c as any as Transferable).$_transferrable_type_id_$) {
		delete (c as any as Transferable).$_transferrable_type_id_$;
	}

	return c;
}

function wrapTransferrable<T>(rem: T): T {
	const transType = (rem as any as Transferable).$_transferrable_type_id_$;
	let local: T;
	if (transType === 'FS') {
		local = wrapRemoteFS(rem as any) as any;
	} else if (transType === 'File') {
		// XXX file object will need a custom wrap to accomodate watch functions,
		// else #198 should be implemented
		
		local = wrapFunctionalRemote(rem);
	} else if (transType === 'SimpleObject') {
		local = wrapFunctionalRemote(rem);
	} else if (transType === 'FSCollection') {
		local = wrapRemoteFSCollection(rem as any) as any;
	} else {
		throw new Error(`Unknown tranferrable object type ${transType}`);
	}
	freezeDeep(local);
	registerTransferable(local, rem);
	return local;
}

type FS = web3n.files.FS;

function wrapRemoteFS(remFS: FS): FS {
	const localFS = wrapFunctionalRemote(remFS);
	
	localFS.watchFolder = (path, localObs) => {
		if (typeof path !== 'string') { throw new TypeError(
			'Given path is not a string'); }
		const remObs = wrapLocalObserver(localObs);
		const remDetach = remFS.watchFolder(path, remObs);
		return () => remDetach();
	};
	
	return localFS;
}

type FSCollection = web3n.files.FSCollection;

function wrapRemoteFSCollection(remColl: FSCollection): FSCollection {
	const localColl = wrapFunctionalRemote(remColl);
	
	localColl.watch = localObs => {
		const remObs = wrapLocalObserver(localObs);
		const remDetach = remColl.watch(remObs);
		return () => remDetach();
	};
	
	return localColl;
}

export function wrapFunctionalRemote<T>(rem: T): T {
	const origType = typeof rem;
	if (origType !== 'object') {
		if (origType === 'function') {
			return wrapRemoteFunc(rem as any);
		} else {
			return rem;
		}
	}
	if (rem === null) { return (null as any); }
	if (Buffer.isBuffer(rem)) {
		return (new Uint8Array(rem)) as any;
	}
	if (ArrayBuffer.isView(rem)) {
		return (rem as any);
	}

	if (Array.isArray(rem)) {
		const arr: any[] = rem;
		const c: any[] = [];
		for (let i=0; i < arr.length; i+=1) {
			c[i] = wrapFunctionalRemote(arr[i]);
		}
		return (c as any);
	}

	const c = ({} as T);
	for (const f of Object.keys(rem)) {
		if (canIncludeField(f)) {
			c[f] = wrapFunctionalRemote<any>(rem[f]);
		}
	}

	return c;
}

const excludedFields = [ '$_transferrable_type_id_$', 'getLinkParams' ];
Object.freeze(excludedFields);

function canIncludeField(fieldName: string): boolean {
	return !excludedFields.includes(fieldName);
}

export function freezeDeep<T>(o: T): T {
	Object.freeze(o);
	if ((typeof o !== 'object') || !o) { return o; }
	for (const f of Object.keys(o)) {
		freezeDeep(o[f]);
	}
	return o;
}

Object.freeze(exports);