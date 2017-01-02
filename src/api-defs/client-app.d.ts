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

/// <reference path="./asmail.d.ts" />
/// <reference path="./storage.d.ts" />
/// <reference path="./device.d.ts" />

declare var w3n: {
	mail: web3n.asmail.Service;
	storage: web3n.storage.Service;
	device: {
		openFileDialog: typeof web3n.device.files.openFileDialog;
		saveFileDialog: typeof web3n.device.files.saveFileDialog;
	};
}
