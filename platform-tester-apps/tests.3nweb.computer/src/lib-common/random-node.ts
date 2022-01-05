/*
 Copyright (C) 2021 3NSoft Inc.
 
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

export function bytesSync(numOfBytes: number): Uint8Array {
	const arr = new Uint8Array(numOfBytes);
	const chunkLen = 65536;
	if (arr.length > chunkLen) {
		const randomChunk = new Uint8Array(chunkLen);
		crypto.getRandomValues(randomChunk);
		for (let ofs=0; ofs<arr.length; ofs+=chunkLen) {
			if (ofs+chunkLen > arr.length) {
				const delta = arr.length - ofs;
				arr.subarray(ofs).set(randomChunk.subarray(0, delta));
			} else {
				arr.subarray(ofs, ofs+chunkLen).set(randomChunk);
			}
		}
	} else {
		crypto.getRandomValues(arr);
	}
	return arr;
}

export async function bytes(numOfBytes: number): Promise<Uint8Array> {
	return bytesSync(numOfBytes);
}


