/*
 Copyright (C) 2017 - 2018 3NSoft Inc.

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
 * This declaration space exists only for implementation code, hence, it is
 * kept separately from definitions that are used by apps.
 */
declare namespace web3n.implementation {

	type TransferableType = 'SimpleObject' | 'File' | 'FS' | 'FSCollection';

	interface Transferable {
		$_transferrable_type_id_$: TransferableType;
	}

}