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

/**
 * This defines interfaces for mail retrieval requests.
 */

import * as midApi from '../mailer-id/login';
import { stringify as stringifyOpts } from 'querystring';

export const ERR_SC = {
	malformed: 400,
	needAuth: midApi.ERR_SC.needAuth,
	server: 500,
	contentTooLong: 413,
	contentLenMissing: 411,
	wrongContentType: 415,
	noSpace: 480
};
Object.freeze(ERR_SC);

export const HTTP_HEADER = {
	contentType: 'Content-Type',
	contentLength: 'Content-Length',
	objVersion: 'X-Version',
	objSegmentsLength: 'X-Obj-Segments-Length'
}
Object.freeze(HTTP_HEADER);

export const BIN_TYPE = 'application/octet-stream';

export namespace midLogin {
	
	export const MID_URL_PART = 'login/mailerid/';
	export const START_URL_END = MID_URL_PART + midApi.startSession.URL_END;
	export const AUTH_URL_END = MID_URL_PART + midApi.authSession.URL_END;

}
Object.freeze(midLogin);

export namespace closeSession {
	
	export const URL_END = 'session/close';
	
}
Object.freeze(closeSession);

export namespace sessionParams {
	
	export const URL_END = 'session/params';
	
	export interface Reply {
		keyDerivParams: any;
		maxChunkSize: number;
	}
	
	export const SC = {
		ok: 200,
	};
	Object.freeze(SC);
	
}
Object.freeze(sessionParams);

export interface GetSegsQueryOpts {
	/**
	 * Offset into segments. If it is missing, zero is assumed.
	 */
	ofs?: number;
	/**
	 * Length of chunk to read from segments. If it is missing, all bytes to
	 * segments end are assumed.
	 */
	len?: number;
}

export interface PutSegsQueryOpts {
	/**
	 * Transaction id, in which these bytes are absorbed.
	 */
	trans: string;
	/**
	 * Indicates that bytes in this request should be appended to the blob.
	 */
	append?: boolean;
	/**
	 * Offset in a blob. It must be present in a not appending mode.
	 */
	ofs?: number;
}

export namespace rootHeader {
	
	export const EXPRESS_URL_END = 'root/header';
	
	export function getReqUrlEnd(version?: number):
			string {
		let optStr = (version ? `?ver=${version}` : '');
		return `${EXPRESS_URL_END}${optStr}`;
	}
	
	export function putReqUrlEnd(transactionId: string): string {
		return `${EXPRESS_URL_END}?trans=${transactionId}`;
	}
	
	export const SC = {
		okGet: 200,
		okPut: 201,
		missing: 474
	};
	Object.freeze(SC);
	
}
Object.freeze(rootHeader);

export namespace rootSegs {
	
	export const EXPRESS_URL_END = 'root/segments';
	
	export function getReqUrlEnd(version: number,
			opts?: GetSegsQueryOpts): string {
		let optStr = `ver=${version}`;
		if (opts) {
			optStr += `&${stringifyOpts(opts)}`;
		}
		return `${EXPRESS_URL_END}?${optStr}`;
	}
	
	export function putReqUrlEnd(opts: PutSegsQueryOpts): string {
		return EXPRESS_URL_END+'?'+stringifyOpts(opts);
	}
	
	export const SC = rootHeader.SC;
	
}
Object.freeze(rootHeader);

export namespace objHeader {
	
	export const EXPRESS_URL_END = 'obj/:objId/header';
	
	export function getReqUrlEnd(objId: string, version?: number):
			string {
		let optStr = (version ? `?ver=${version}` : '');
		return `obj/${objId}/header${optStr}`;
	}
	
	export function putReqUrlEnd(objId: string, transactionId: string): string {
		return `obj/${objId}/header?trans=${transactionId}`;
	}
	
	export const SC = {
		okGet: 200,
		okPut: 201,
		missing: 474
	};
	Object.freeze(SC);
	
}
Object.freeze(objHeader);

export namespace objSegs {
	
	export const EXPRESS_URL_END = 'obj/:objId/segments';
	
	export function getReqUrlEnd(objId: string, version: number,
			opts?: GetSegsQueryOpts): string {
		let optStr = `ver=${version}`;
		if (opts) {
			optStr += `&${stringifyOpts(opts)}`;
		}
		return `obj/${objId}/segments?${optStr}`;
	}
	
	export function putReqUrlEnd(objId: string, opts: PutSegsQueryOpts): string {
		return `obj/${objId}/segments?${stringifyOpts(opts)}`;
	}
	
	export const SC = objHeader.SC;
	
}
Object.freeze(objSegs);

export interface DiffInfo {
	
	/**
	 * This is base version for this diff.
	 */
	baseVersion: number;
	
	/**
	 * This is a length of segments, calculable from sections.
	 */
	segsSize: number;

	/**
	 * Sector is described by number array with three elements:
	 * 0th element is 0 for base bytes, and 1 for new bytes;
	 * 1st element is an offset in base/new byte array;
	 * 2nd element is a length of the sector.
	 */
	sections: number[][];
}

export function addDiffSectionTo(sections: number[][],
		newBytes: boolean, srcPos: number, len: number): void {
	sections.push([ (newBytes ? 1 : 0), srcPos, len ]);
} 

export interface TransactionParams {
	isNewObj?: boolean;
	version: number;
	sizes: {
		header: number;
		segments: number;
	};
	diff?: DiffInfo;
}

export namespace startTransaction {
	
	export const EXPRESS_URL_END = 'obj/:objId/transaction/start';
	
	export function getReqUrlEnd(objId: string): string {
		return `obj/${objId}/transaction/start`;
	}
	
	export type Request = TransactionParams;
	
	export interface Reply {
		transactionId: string;
	}
	
	export const SC = {
		ok: 200,
		unknownObj: 474,
		objAlreadyExists: 473,
		concurrentTransaction: 483,
		incompatibleObjState: 484
	};
	Object.freeze(SC);
	
}
Object.freeze(startTransaction);

export namespace startRootTransaction {
	
	export const URL_END = 'root/transaction/start';
	
	export interface Request extends startTransaction.Request {}
	
	export interface Reply extends startTransaction.Reply {}
	
	export const SC = startTransaction.SC;
	
}
Object.freeze(startRootTransaction);

export namespace finalizeTransaction {
	
	export const EXPRESS_URL_END =
		'obj/:objId/transaction/finalize/:transactionId';
	
	export function getReqUrlEnd(objId: string, transactionId: string): string {
		return `obj/${objId}/transaction/finalize/${transactionId}`;
	}
	
	export const SC = {
		ok: 200,
		missing: 474
	};
	Object.freeze(SC);
	
}
Object.freeze(finalizeTransaction);

export namespace cancelTransaction {
	
	export const EXPRESS_URL_END = 'obj/:objId/transaction/cancel/:transactionId';
	
	export function getReqUrlEnd(objId: string, transactionId: string): string {
		return `obj/${objId}/transaction/cancel/${transactionId}`;
	}
	
	export const SC = finalizeTransaction.SC;
	
}
Object.freeze(cancelTransaction);

export namespace finalizeRootTransaction {
	
	export const EXPRESS_URL_END = 'root/transaction/finalize/:transactionId';
	
	export function getReqUrlEnd(transactionId: string): string {
		return `root/transaction/finalize/${transactionId}`;
	}
	
	export const SC = finalizeTransaction.SC;
	
}
Object.freeze(finalizeRootTransaction);

export namespace cancelRootTransaction {
	
	export const EXPRESS_URL_END = 'root/transaction/cancel/:transactionId';
	
	export function getReqUrlEnd(transactionId: string): string {
		return `root/transaction/cancel/${transactionId}`;
	}
	
	export const SC = finalizeTransaction.SC;
	
}
Object.freeze(cancelRootTransaction);

export namespace objArchive {
	
	export const EXPRESS_URL_END = 'obj/:objId/archive';
	
	export function getReqUrlEnd(objId: string): string {
		return `obj/${objId}/archive`;
	}
	
	export const SC = {
		ok: 200,
		missing: 474
	};

}
Object.freeze(objArchive);

export namespace rootArchive {
	
	export const URL_END = 'root/archive';
	
	export const SC = objArchive.SC;

}
Object.freeze(rootArchive);

export namespace deleteObj {
	
	export const EXPRESS_URL_END = 'obj/:objId';
	
	export function getReqUrlEnd(objId: string): string {
		return `obj/${objId}`;
	}
	
	export const SC = {
		ok: 200,
		missing: 474,
		concurrentTransaction: 483,
		incompatibleObjState: 484
	};
	
}
Object.freeze(deleteObj);

export namespace deleteArchivedRootVersion {
	
	export const EXPRESS_URL_END = 'root/version/:version';
	
	export function getReqUrlEnd(version: string): string {
		return `root/version/${version}`;
	}
	
	export const SC = deleteObj.SC;
	
}
Object.freeze(deleteArchivedRootVersion);

export namespace deleteArchivedObjVersion {
	
	export const EXPRESS_URL_END = 'obj/:objId/version/:version';
	
	export function getReqUrlEnd(objId: string, version: string): string {
		return `obj/${objId}/version/${version}`;
	}
	
	export const SC = deleteObj.SC;
	
}
Object.freeze(deleteArchivedObjVersion);



export interface ErrorReply {
	error: string;
}

Object.freeze(exports);