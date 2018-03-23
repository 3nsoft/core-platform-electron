/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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

	private filling: Map<TKey, TVal> = new Map<TKey, TVal>();
	private waiting: Map<TKey, TVal> = new Map<TKey, TVal>();
	private interval: NodeJS.Timer|void;

	constructor(periodMillis: number,
			private canItemTimeout?: (val: TVal) => boolean) {
		this.interval = setInterval(
			() => { this.dropAndRotate(); }, periodMillis);
		this.interval.unref();
		Object.seal(this);
	}

	private dropAndRotate(): void {
		if (this.canItemTimeout) {
			// save items that cannot be dropped by putting them into filling
			for (const entry of this.waiting.entries()) {
				if (this.canItemTimeout(entry[1])) { continue; }
				this.filling.set(entry[0], entry[1]);
			}
		}
		this.waiting.clear();
		const b = this.waiting;
		this.waiting = this.filling;
		this.filling = b;
	}

	get(key: TKey): TVal | undefined {
		let v = this.filling.get(key);
		if (v !== undefined) { return v; }
		v = this.waiting.get(key);
		if (v !== undefined) {
			this.filling.set(key, v);
		}
		return v
	}

	has(key: TKey): boolean {
		return (this.get(key) !== undefined);
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
		if (!this.interval) { return; }
		clearInterval(this.interval);
		this.interval = undefined;
		this.filling = (undefined as any);
		this.waiting = (undefined as any);
	}

}
Object.freeze(TimeWindowCache.prototype);
Object.freeze(TimeWindowCache);

Object.freeze(exports);