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

import { Duplex } from '../lib-common/ipc/electron-ipc';
import { asmail } from './common';

let names = asmail.uiReqNames;

export function makeASMailOnUISide(core: Duplex): Web3N.ASMail.Service {
	let mail: Web3N.ASMail.Service = {
		
		getUserId(): Promise<string> {
			return core.makeRequest<string>(names.getUserId, null);
		},
		
		preFlight(toAddress: string): Promise<number> {
			return core.makeRequest<number>(names.sendPreFlight, toAddress);
		},
		
		sendMsg(recipient: string, msg: Web3N.ASMail.OutgoingMessage):
				Promise<string> {
			return core.makeRequest<string>(names.sendMsg, { recipient, msg });
		},
		
		listMsgs(fromTS?: number): Promise<Web3N.ASMail.MsgInfo[]> {
			return core.makeRequest<Web3N.ASMail.MsgInfo[]>(
				names.listMsgs, fromTS);
		},
		
		removeMsg(msgId: string): Promise<void> {
			return core.makeRequest<void>(names.removeMsg, msgId);
		},
		
		getMsg(msgId: string): Promise<Web3N.ASMail.IncomingMessage> {
			return core.makeRequest<Web3N.ASMail.IncomingMessage>(
				names.getMsg, msgId);
		},
		
		makeAttachmentsContainer(): Web3N.ASMail.AttachmentsContainer {
			throw `Function is not implemented, yet`;
		}
		
	};
	Object.freeze(mail);
	return mail;
}

Object.freeze(exports);