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

export interface Region {
	start: number;
	end: number;
}

function invertRegions(regs: Region[],
		start: number, end: number): Region[] {
	let inverted: Region[] = [];
	for (let i=0; i<regs.length; i+=1) {
		let reg = regs[i];
		if (start < reg.start) {
			inverted.push({ start: start, end: reg.start });
		}
		start = reg.end;
	}
	if (start < end) {
		inverted.push({ start: start, end: end });
	} else if (inverted.length > 0) {
		let lastReg = inverted[inverted.length-1];
		if (lastReg.end > end) {
			lastReg.end = end;
		} 
	}
	return inverted;
}

export function missingRegionsIn(
		start: number, end: number, cached: Region[]): Region[] {
	let startInd: number|undefined = undefined;
	let endInd: number|undefined = undefined;
	for (let i=0; i<cached.length; i+=1) {
		let reg = cached[i];
		if ((startInd === undefined) &&
				((start <= reg.start) || (start < reg.end))) {
			if (end <= reg.start) { break; }
			startInd = i;
		}
		if (startInd !== undefined) {
			endInd = i;
		}
		if (end <= reg.end) {
			break;
		}
	}
	if (startInd === undefined) {
		return [{ start, end }];
	} else {
		let cachedRegions = cached.slice(startInd, endInd+1);
		let inverted = invertRegions(cachedRegions, start, end);
		return inverted;
	}
}

/**
 * This function splits big regions to fit given size.
 * @param regs array of regions -- objects with start and end non-negative
 * integer fields
 * @param size is a maximal length allowed each individual region
 */
export function splitBigRegions(regs: Region[],
		size: number): void {
	for (let i=0; i<regs.length; i+=1) {
		let reg = regs[i];
		let regLen = reg.end - reg.start;
		if (regLen <= size) { continue; }
		while (regLen > size) {
			let newRegLen = (regLen > 1.5*size) ? size : Math.round(regLen / 2);
			let newReg = {
				start: reg.start,
				end: reg.start + newRegLen
			};
			regs.splice(i, 0, newReg);
			i += 1;
			reg.start += newRegLen;
			regLen = reg.end - reg.start;
		}
	}
}

/**
 * Merges new region boundary info object into an existing non-empty array.
 * @param regs should be a non-empty array of region boundary infos
 * @param newReg is a new region, that should be merged into array
 * @param warnOnOverlap is a flag, which default true value turns on warning
 * on overlaps, with false value, suppressing them. Default value is for
 * production, while false value is useful for tests.
 */
export function mergeRegions(regs: Region[], newReg: Region,
		warnOnOverlap = true): void {
	if (regs.length === 0) {
		regs.push(newReg);
		return;
	}
	for (let i=0; i < regs.length; i+=1) {
		let seg = regs[i];
		if (newReg.start > seg.end) {
			// newSeg is to the right of seg
			if ((i+1) < regs.length) {
				continue;
			} else {
				regs.push(newReg);
			}
		} else if (seg.start > newReg.end) {
			// newSeg is to the left of seg
			regs.splice(i, 0, newReg);
		} else if (seg.start === newReg.end) {
			// newSeg touches seg on its left
			seg.start = newReg.start;
		} if (newReg.start === seg.end) {
			// newSeg touches seg on its right
			if (i+1 < regs.length) {
				regs.splice(i, 1);
				i -= 1;
				newReg.start = seg.start;
				continue;
			} else {
				seg.end = newReg.end;
			}
		} else {
			// overlap situations
			if (warnOnOverlap) { console.warn(
				`There is an overlap in cache saving: original regions are ${JSON.stringify(regs)}, new region is ${JSON.stringify(newReg)}`); }
			if (i+1 < regs.length) {
				regs.splice(i, 1);
				i -= 1;
				newReg.start = Math.min(seg.start, newReg.start);
				newReg.end = Math.max(seg.end, newReg.end);
				continue;
			} else {
				seg.start = Math.min(seg.start, newReg.start);
				seg.end = Math.max(seg.end, newReg.end);
			}
		}
		break;
	}
}

Object.freeze(exports);