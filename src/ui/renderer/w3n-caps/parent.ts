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

import { makeRPC } from '../../../lib-common/apps-rpc/renderer-side';
import { isObjectFromCore, findTransferableRemote } from '../wrapping';
import { RPCLink } from '../../../lib-common/apps-rpc/core-side';
import { bind } from '../../../lib-common/binding';

export type RPC = web3n.rpc.RPC;

export function wrapRemoteRPC(remRPCLink: RPC): RPC {
	const rpcLink = wrapRemoteRPCLink(remRPCLink as any as RPCLink);
	return makeRPC(rpcLink, isObjectFromCore);
}

function wrapRemoteRPCLink(rem: RPCLink): RPCLink {
	const local: RPCLink = {
		getFromWMap: rem.getFromWMap,
		setApp: rem.setApp,
		setToWMap: rem.setToWMap,
		sendMsg: wrapSendMsg(rem),
		close: rem.close,
	};
	return local;
}

function wrapSendMsg(rem: RPCLink): RPCLink['sendMsg'] {
	return (app, msg) => {
		if (msg.length === 1) {
			rem.sendMsg(app, msg);
			return;
		}

		const msgWithRemotes = Array.from(msg);
		for (let i=2; i<msg.length; i+=2) {
			const local = msg[i];
			if (ArrayBuffer.isView(local)) { continue; }
			msgWithRemotes[i] = findTransferableRemote(local);
		}
		rem.sendMsg(app, msgWithRemotes);
	}
}