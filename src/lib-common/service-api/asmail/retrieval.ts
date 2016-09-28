/*
 Copyright (C) 2015 3NSoft Inc.
 
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
 * This defines interfaces for mail retrieval requests.
 */

import * as midApi from '../mailer-id/login';
import * as deliveryApi from './delivery';
import { stringify as stringifyOpts } from 'querystring';

export const ERR_SC = {
	malformed: 400,
	needAuth: midApi.ERR_SC.needAuth,
	server: 500
};
Object.freeze(ERR_SC);

export namespace midLogin {
	
	export const MID_URL_PART = 'login/mailerid/';
	export const START_URL_END = MID_URL_PART + midApi.startSession.URL_END;
	export const AUTH_URL_END = MID_URL_PART + midApi.authSession.URL_END;

}
Object.freeze(midLogin);

export namespace closeSession {
	
	export const URL_END = 'close-session';
	
}
Object.freeze(closeSession);

export namespace listMsgs {
	
	export const URL_END = 'msg/ids';
	
	export interface Reply extends Array<string> {}
	
	export const SC = {
		ok: 200,
	};
	Object.freeze(SC);
	
}
Object.freeze(listMsgs);

export namespace rmMsg {
	
	export const EXPRESS_URL_END = 'msg/:msgId';
	
	export function genUrlEnd(msgId: string): string {
		return 'msg/'+msgId;
	}
	
	export const SC = {
		ok: 200,
		unknownMsg: 474
	};
	Object.freeze(SC);
	
}
Object.freeze(rmMsg);

export interface ObjSize {
	header: number;
	segments: number;
}

export interface MsgMeta  {
	extMeta: deliveryApi.msgMeta.Request;
	deliveryStart: number;
	authSender: string;
	deliveryCompletion?: number;
	objSizes?: { [objId: string]: ObjSize; };
}

export namespace msgMetadata {
	
	export const EXPRESS_URL_END = 'msg/:msgId/meta';
	
	export function genUrlEnd(msgId: string): string {
		return 'msg/'+msgId+'/meta';
	}
	
	export interface Reply extends MsgMeta {}
	
	export const SC = {
		ok: 200,
		unknownMsg: 474
	};
	Object.freeze(SC);
	
}
Object.freeze(msgMetadata);

export interface BlobQueryOpts {
	/**
	 * Offset in a blob. It must be present with length parameter.
	 */
	ofs?: number;
	/**
	 * Length in a blob's chunk. It must be present with offset parameter.
	 */
	len?: number;
}

export namespace msgObjHeader {
	
	export const EXPRESS_URL_END = 'msg/:msgId/obj/:objId/header';
	
	export function genUrlEnd(msgId: string, objId: string,
			opts?: BlobQueryOpts): string {
		let optStr = (opts ? '?'+stringifyOpts(opts) : '');
		return `msg/${msgId}/obj/${objId}/header${optStr}`;
	}
	
	export const SC = {
		ok: 200,
		unknownMsgOrObj: 474
	};
	Object.freeze(SC);
	
}
Object.freeze(msgObjHeader);

export namespace msgObjSegs {
	
	export const EXPRESS_URL_END = 'msg/:msgId/obj/:objId/segments';
	
	export function genUrlEnd(msgId: string, objId: string,
			opts?: BlobQueryOpts): string {
		let optStr = (opts ? '?'+stringifyOpts(opts) : '');
		return `msg/${msgId}/obj/${objId}/segments${optStr}`;
	}
	
	export const SC = msgObjHeader.SC;
	
}
Object.freeze(msgObjSegs);

export interface ErrorReply {
	error: string;
}

Object.freeze(exports);