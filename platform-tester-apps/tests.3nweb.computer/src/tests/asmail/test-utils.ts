/*
 Copyright (C) 2017 - 2018, 2020 - 2021 3NSoft Inc.
 
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

import { SpecIt as GenericSpecIt } from "../libs-for-tests/spec-module.js";
import { assert } from "../../lib-common/assert.js";
import { errWithCause, stringifyErr } from "../../lib-common/exceptions/error.js";
import { FileTreeListing } from "./second-user.js";
import { deepEqual } from "../libs-for-tests/json-equal.js";

type DeliveryProgress = web3n.asmail.DeliveryProgress;
type WritableFS = web3n.files.WritableFS;

export interface SetupForASMail {
	isUp: boolean;
	thisUser: string;
	secondUser: string;
	testFolder: WritableFS;
}

export type SpecIt = GenericSpecIt<SetupForASMail>;

export function throwDeliveryErrorFrom(lastNotif: DeliveryProgress): void {
	assert(lastNotif.allDone, `Given delivery notification is not last`);
	for (const info of Object.values(lastNotif.recipients)) {
		if (info.err) {
			throw errWithCause(
				info.err,
				`Error occured in message delivery:\n${stringifyErr(info.err)}`);
		}
	}
}

export interface FileTreeContent {
	[name: string]: FileTreeContent|Uint8Array|string;
}

export async function writeFilesTreeContent(
	tree: FileTreeContent, fs: WritableFS
): Promise<void> {
	for (const fName of Object.keys(tree)) {
		const content = tree[fName];
		if (typeof content === 'string') {
			await fs.writeTxtFile(fName, content);
		} else if (typeof content.length === 'number') {
			await fs.writeBytes(fName, content as Uint8Array);
		} else {
			const subFS = await fs.writableSubRoot(fName);
			await writeFilesTreeContent(content as FileTreeContent, subFS);
		}
	}
}

export function treeContentToLising(tree: FileTreeContent): FileTreeListing {
	const listing: FileTreeListing = {};
	for (const fName of Object.keys(tree)) {
		const content = tree[fName];
		listing[fName] = ((typeof content.length === 'number') ?
			content.length : treeContentToLising(content as FileTreeContent));
	}
	return listing;
}

export function compareTreeListingWithExpectedContent(
	listing: FileTreeListing, tree: FileTreeContent
): boolean {
	return deepEqual(listing, treeContentToLising(tree));
}
