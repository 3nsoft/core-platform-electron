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

import { CAPsMap } from '../caps-map';
import { wrapRemoteFunc } from '../wrapping';
import { wrapRemoteRPC } from './parent';

export type ChildWindow = web3n.ui.ChildWindow;
export type OpenChildWindow = web3n.ui.OpenChildWindow;

type W3N = web3n.ui.W3N;

export function wrapRemoteChildWindowOpener(rem: OpenChildWindow,
		capsMap: CAPsMap): OpenChildWindow {

	const capsWrapper = local => getRemoteCAPsFor(local, capsMap);

	const opener = wrapRemoteFunc(rem,
		[ null, null, null, null, capsWrapper ],
		wrapChildWindow);
	
	return opener;
}

function getRemoteCAPsFor(w3n: W3N, capsMap: CAPsMap): W3N|undefined {
	if (!w3n || (typeof w3n !== 'object')) { return; }
	if ((<any> window).w3n === w3n) { throw new Error(`Transferring parents' capabilities wholesome to child is discouraged.`); }
	const remoteW3N: W3N = {};
	for (const capName of Object.keys(w3n)) {
		const localCAP = w3n[capName];
		if (!localCAP) { continue; }
		remoteW3N[capName] = capsMap.findRemoteCAP(capName, localCAP);
	}
	return remoteW3N;
}

function wrapChildWindow(rem: ChildWindow): ChildWindow {
	const childWin: ChildWindow = {
		destroy: () => { rem.destroy(); }
	};
	if (rem.rpc) {
		childWin.rpc = wrapRemoteRPC(rem.rpc);
	}
	return Object.freeze(childWin);
}
