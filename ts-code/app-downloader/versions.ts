/*
 Copyright (C) 2019 - 2021 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

export type SemVersion = [ number, number, number ];

export function compareVersions(v1: SemVersion, v2: SemVersion): number {
	for (let i=0; i<3; i+=1) {
		const delta = v1[i] - v2[i];
		if (delta === 0) { continue; }
		else if (delta > 0) { return 1; }
		else if (delta < 0) { return -1; }
	}
	return 0;
}

const symVerRegExp = /\d+\.\d+\.\d+/;

export function toSymVer(v: string): SemVersion|undefined {
	const match = v.match(symVerRegExp);
	if (!match) { return; }
	return match[0].split('.').map((s: any) => parseInt(s)) as SemVersion;
}

export function latestVersionIn(versions: string[]): string {
	if (versions.length === 0) {
		throw new Error(`Versions array is empty`);
	} else {
		let latest = versions[versions.length-1];
		let latestSV = toSymVer(latest);
		for (let i=versions.length-2; i>=0; i-=1) {
			const v = versions[i];
			const sv = toSymVer(v);
			if (latestSV) {
				if (sv && (compareVersions(sv, latestSV) > 1)) {
					latest = v;
					latestSV = sv;
				}
			} else {
				if (sv || (latest < v)) {
					latest = v;
				}
			}
		}
		return latest;
	}
}


Object.freeze(exports);