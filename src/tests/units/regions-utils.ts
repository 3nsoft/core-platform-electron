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

import { Region, missingRegionsIn } from '../../lib-client/local-files/regions';

describe('Calculating function missingRegionsIn', () => {
	
	const existingRegions: Region[] = [ {
		start: 100,
		end: 200,
	}, {
		start: 450,
		end: 550
	} ];

	function checkMissing(start: number, end: number, expected: Region[]): void {
		let missingRegions = missingRegionsIn(start, end, existingRegions);
		expect(Array.isArray(missingRegions)).toBe(true, 'function must return an array');
		expect(missingRegions.length).toBe(expected.length, 'expected number of missing regions');
		for (let i=0; i<expected.length; i+=1) {
			expect(missingRegions[i].start).toBe(expected[i].start, `expected start of a missing region with index ${i}`);
			expect(missingRegions[i].end).toBe(expected[i].end, `expected end of a missing region with index ${i}`);
		}
	}

	it('returns the whole region when no overlap found', () => {
		checkMissing(0, 50, [{ start: 0, end: 50 }]);
		checkMissing(0, 100, [{ start: 0, end: 100 }]);
		checkMissing(200, 450, [{ start: 200, end: 450 }]);
		checkMissing(300, 400, [{ start: 300, end: 400 }]);
		checkMissing(550, 900, [{ start: 550, end: 900 }]);
		checkMissing(900, 1000, [{ start: 900, end: 1000 }]);
	});

	it('returns regions when there is a partial overlap', () => {
		checkMissing(0, 150, [{ start: 0, end: 100 }]);
		checkMissing(0, 300, [{ start: 0, end: 100 }, { start: 200, end: 300 }]);
		checkMissing(0, 500, [{ start: 0, end: 100 }, { start: 200, end: 450 }]);
		checkMissing(0, 900, [{ start: 0, end: 100 }, { start: 200, end: 450 },
			{ start: 550, end: 900 }]);
		checkMissing(150, 300, [{ start: 200, end: 300 }]);
		checkMissing(150, 500, [{ start: 200, end: 450 }]);
		checkMissing(300, 500, [{ start: 300, end: 450 }]);
		checkMissing(300, 900, [{ start: 300, end: 450 },
			{ start: 550, end: 900 }]);
		checkMissing(500, 900, [{ start: 550, end: 900 }]);
	});

	it('returns no regions when overlap is complete', () => {
		checkMissing(110, 150, []);
		checkMissing(100, 200, []);
		checkMissing(500, 520, []);
		checkMissing(450, 550, []);
	});

});