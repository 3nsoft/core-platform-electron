/*
 Copyright (C) 2015 - 2016 3NSoft Inc.
 
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

import { JsonKeyShort } from '../../../lib-common/jwkeys';
import { FolderInfo } from '../../3nstorage/xsp-fs/common';

/**
 * Metadata for message that uses established key pair. 
 * It is an unencrypted part of a message.
 */
export interface MetaForEstablishedKeyPair {
	pid: string;
}

/**
 * Metadata for message that uses introductory keys.
 * It is an unencrypted part of a message.
 */
export interface MetaForNewKey {
	recipientKid: string;
	senderPKey: string;
}

/**
 * Main (zeroth) object json.
 * It is an encrypted part of a message.
 */
export interface MainData {
	[field: string]: any;
}

/**
 * Object with suggested next crypto.
 * Located in main object.
 */
export interface SuggestedNextKeyPair {
	pids: string[];
	senderKid: string;
	recipientPKey: JsonKeyShort;
	invitation?: string;
}

/**
 * Common fields in main object.
 */
export const headers = {
	FROM: 'From',
	TO: 'To',
	CC: 'Cc',
	SUBJECT: 'Subject',
	DO_NOT_REPLY: 'Do Not Reply',
	MSG_TYPE: 'Msg Type'
};
Object.freeze(headers);

/**
 * Common fields in a main object, managed by api a little closer.
 */
export const managedFields = {
	BODY: 'Body',
	NEXT_CRYPTO: 'Next Crypto',
	CRYPTO_CERTIF: 'Crypto Certification',
	ATTACHMENTS: 'Attachments'
};
Object.freeze(managedFields);

const fieldsInLowCase: string[] = [];
for (const fName of Object.keys(managedFields)) {
	fieldsInLowCase.push(managedFields[fName].toLowerCase());
}
export function isManagedField(name: string): boolean {
	return (fieldsInLowCase.indexOf(name.toLowerCase()) > -1);
}

/**
 * 
 */
export interface MainBody {
	text?: {
		plain?: string;
		html?: string;
	},
	json?: any;
}

Object.freeze(exports);