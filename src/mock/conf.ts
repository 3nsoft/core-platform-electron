/*
 Copyright (C) 2017 3NSoft Inc.

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

export interface MockConfig {
	users: number[];
	mail: ASMailMockConfig;
}

export interface ASMailMockConfig {
	existingUsers: ASMailUserConfig[];
	knownDomains?: string[];
	misconfiguredDomains?: string[];
	network: {
		latencyMillis?: number;
		upSpeedKBs?: number;
	};
}

export interface ASMailUserConfig {
	address: string;
	defaultMsgSize?: number;
	inboxIsFull?: boolean;
}

export function validateConfs(mockConf: MockConfig) {
	if (!Array.isArray(mockConf.users) || (mockConf.users.length === 0)) {
		throw new Error(`Configuration file must have field 'users' as an array of numeric idecies, corresponding to positions in array 'mail.existingUsers', to inidicate users, for who to open an app window.`);
	}
	for (const userInd of mockConf.users) {
		if (!mockConf.mail.existingUsers[userInd]) {
			throw new Error(`User index '${userInd}' doesn't point to any existing user.`);
		}
	}
}

Object.freeze(exports);