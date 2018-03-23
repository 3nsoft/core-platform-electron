/*
 Copyright (C) 2017 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

 This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with this program. If not, see <http://www.gnu.org/licenses/>. */

import { Subject, Observable, Observer } from 'rxjs';
 
export interface TriggerableObservable<T> {
	item$: Observable<T>;
	next: () => void;
	isDone(): boolean;
}

/**
 * This returns a triggerable observable with events from a given argument.
 * Note that, when there are N events, function next should be called N+1 times
 * to emit all events and to complete returned observable.
 * @param arrOrIter is either an array or an iterator, with all of events in
 * this observable.
 */
export function toTriggerableObservable<T>(arrOrIter: T[]|IterableIterator<T>):
		TriggerableObservable<T> {
	let trig = new Subject<void>();
	const iterator = (Array.isArray(arrOrIter) ?
		arrOrIter.entries() : arrOrIter);
	const item$ = trig.asObservable()
	.map(() => iterator.next())
	.filter(res => {
		if (!res.done) { return true; }
		trig.complete();
		trig = undefined as any;
		return false;
	})
	.map(res => res.value[1]);
	const next = () => {
		if (trig) { trig.next(); }
	};
	const isDone = () => !trig;
	return { item$, next, isDone };
}

/**
 * This function returns an observable with a single event, emitted when given
 * observable completes.
 * @param x is an observable, which completion we want to get as an event.
 */
export function completionAsObservable(x: Observable<any>): Observable<void> {
	return Observable.create((obs: Observer<void>) => {
		const sub = x.subscribe(
			undefined,
			e => obs.error(e),
			() => {
				obs.next(undefined);
				obs.complete();
			});
		return () => sub.unsubscribe();
	});
}

/**
 * This function returns an observable of orderly started and concatenated given
 * observables. Note that unlike a common concat, this doesn't subscribe all
 * given observables at the same time, e.g. observable N+1 is started
 * (subscribed) after completion of observable N.
 * @param obs$ is a spreaded array of observables that should be processed one
 * by one.
 */
export function concatWithDelayedStart<T>(...obs$: Observable<T>[]):
		Observable<T> {
	return Observable.create((obs: Observer<T>) => {
		const tob = toTriggerableObservable(obs$);

		const sub = tob.item$
		.flatMap(o => o.do(undefined as any, undefined, tob.next))
		.subscribe(obs);

		tob.next();
		return () => sub.unsubscribe();
	});
}

export function processLazily<W, R>(work: W[], op: (w: W) => Observable<R>):
		Observable<R> {
	return Observable.create((obs: Observer<R>) => {
		const tob = toTriggerableObservable(work);

		const sub = tob.item$
		.flatMap(w => op(w).do(undefined as any, undefined, tob.next))
		.subscribe(obs);

		tob.next();
		return () => sub.unsubscribe();
	});
}