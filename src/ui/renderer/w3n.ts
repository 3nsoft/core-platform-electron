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

import { CAPsMap, makeCAPsMap } from './caps-map';
import { wrapFunctionalRemote, freezeDeep } from './wrapping';
import { wrapRemoteSignIn } from './w3n-caps/signin';
import { wrapRemoteSignUp } from './w3n-caps/signup';
import { wrapRemoteMail } from './w3n-caps/mail';
import { wrapRemoteRPC } from './w3n-caps/parent';
import { wrapRemoteChildWindowOpener } from './w3n-caps/child-window';

type CAPWrapper<T> = (cap: T, capsMap: CAPsMap) => T;
type W3N = web3n.ui.W3N;
type CAPNames = keyof W3N | 'signIn' | 'signUp';

// triplets contain cap's: name, is-transferable-to-child flag, wrapper function
const capWrappers: [ CAPNames, boolean, CAPWrapper<any> ][] = [
	[ 'signIn', false, wrapRemoteSignIn ],
	[ 'signUp', false, wrapRemoteSignUp ],
	[ 'device', true, wrapSimpleCAP ],
	[ 'mail', false, wrapRemoteMail ],
	[ 'storage', false, wrapSimpleCAP ],
	[ 'openChildWindow', true, wrapRemoteChildWindowOpener ],
	[ 'parent', false, wrapRemoteRPC ],
	[ 'openViewer', true, wrapSimpleCAP ],
	[ 'openWithOSApp', true, wrapSimpleCAP ],
	[ 'openWithOSBrowser', true, wrapSimpleCAP ],
	[ 'log', true, wrapSimpleCAP ],
	[ 'closeSelf', false, wrapSimpleCAP ],
];

export function makeW3NProxy(remoteW3N: W3N): W3N {
	const capsMap = makeCAPsMap();

	const w3n: W3N = {};
	for (const capWrap of capWrappers) {
		const capName = capWrap[0];
		const remoteCAP = remoteW3N[capName];
		if (!remoteCAP) { continue; }

		const capWrapper = capWrap[2];
		const localCAP = capWrapper(remoteCAP, capsMap);
		w3n[capName] = localCAP;

		if (capWrap[1]) {
			capsMap.addCAP(capName, localCAP, remoteCAP);
		}
	}
	return Object.freeze(w3n);
}

function wrapSimpleCAP<T>(rem: T): T {
	const cap = wrapFunctionalRemote(rem);
	return freezeDeep(cap);
}