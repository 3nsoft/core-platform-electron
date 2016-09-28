/*
 Copyright (C) 2016 3NSoft Inc.
 
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

export class TimeWindowCache<TKey, TVal> {

	private filling = new Map<TKey, TVal>();
	private waiting = new Map<TKey, TVal>();
	private interval: NodeJS.Timer;

	constructor(periodMillis: number) {
		this.interval = setInterval(
			() => { this.dropAndRotate(); }, periodMillis);
		this.interval.unref();
		Object.seal(this);
	}

	private dropAndRotate(): void {
		this.waiting.clear();
		let b = this.waiting;
		this.waiting = this.filling;
		this.filling = b;
	}

	get(key: TKey): TVal {
		let v = this.filling.get(key);
		if (v !== undefined) { return v; }
		v = this.waiting.get(key);
		if (v !== undefined) {
			this.filling.set(key, v);
		}
		return v
	}

	set(key: TKey, val: TVal): void {
		this.filling.set(key, val);
	}

	delete(key: TKey): void {
		this.filling.delete(key);
		this.waiting.delete(key);
	}

	clear(): void {
		this.filling.clear();
		this.waiting.clear();
	}

	destroy() {
		if (this.interval === null) { return; }
		clearInterval(this.interval);
		this.interval = null;
		this.filling = null;
		this.waiting = null;
	}

}
Object.freeze(TimeWindowCache.prototype);
Object.freeze(TimeWindowCache);

Object.freeze(exports);