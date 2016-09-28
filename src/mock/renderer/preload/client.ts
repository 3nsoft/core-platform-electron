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

/**
 * This is a preloading script for client app with messenger and contacts.
 * This script sets up asmail api, besides file system.
 */

import { make3NWebObject } from '../client-app';
import { readFileSync } from 'fs';
import { FileException, Code as excCode }
	from '../../../lib-common/exceptions/file';
import { errWithCause } from '../../../lib-common/exceptions/error';
import { resolve } from 'path';
import * as url from 'url';

try {
	let mockConf = JSON.parse(readFileSync(
		resolve(__dirname, '../../../apps/client/mock-conf.json'), 'utf8'));
	
	let userIndex = (() => {
		let u = url.parse(location.href, true);
		let ind  = parseInt(u.query['user']);
		if (isNaN(ind)) {
			throw new Error('Valid user index is missing in a url query string.');
		} else {
			return ind;
		}
	})();

	(<any> window).w3n = make3NWebObject(
		userIndex, mockConf.mail, mockConf.storage);
} catch (e) {
	if ((<FileException> e).code === excCode.notFound) {
		throw errWithCause(e, 'Missing mock configuration file for client app');
	} else {
		throw errWithCause(e, 'Cannot initialize platform mock for client app');
	}
}