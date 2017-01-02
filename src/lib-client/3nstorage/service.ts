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
 * This defines functions that implement 3NStorage protocol.
 */

import { makeException } from '../xhr-utils';
import * as api from '../../lib-common/service-api/3nstorage/owner';
import { TransactionParams }
	from '../../lib-common/service-api/3nstorage/owner';
import { ServiceUser, IGetMailerIdSigner } from '../user-with-mid-session';
import { storageInfoAt } from '../service-locator';
import * as keyGen from '../key-derivation';
import { makeObjNotFoundExc, makeObjExistsExc, makeConcurrentTransExc,
	makeWrongStateExc, makeUnknownObjOrTransExc } from './exceptions';

export { TransactionParams }
	from '../../lib-common/service-api/3nstorage/owner';

export class StorageOwner extends ServiceUser {
	
	private keyDerivParams: keyGen.ScryptGenParams = (undefined as any);
	maxChunkSize: number = (undefined as any);
	private serviceURIGetter: () => Promise<string> = (undefined as any);
	
	constructor(user: string, getSigner: IGetMailerIdSigner) {
		super(user, {
			login: api.midLogin.MID_URL_PART,
			logout: api.closeSession.URL_END,
			canBeRedirected: true
		}, getSigner);
		Object.seal(this);
	}

	private async setServiceUrl(serviceUrl?: string): Promise<void> {
		if (!serviceUrl) {
			serviceUrl = await this.serviceURIGetter();
		}
		let info = await storageInfoAt(serviceUrl);
		if (!info.owner) { throw new Error(`Missing owner service url in 3NStorage information at ${serviceUrl}`); }
		this.serviceURI = info.owner;
	}

	async setStorageUrl(serviceUrl: string|(() => Promise<string>)):
			Promise<void> {
		if (typeof serviceUrl === 'string') {
			await this.setServiceUrl(serviceUrl);
		} else {
			this.serviceURIGetter = serviceUrl;
		}
	}
	
	// XXX keyDerivParams should be moved to a separate request, out of
	//		session setting
	async getKeyDerivParams(): Promise<keyGen.ScryptGenParams> {
		if (this.keyDerivParams) { return this.keyDerivParams; }
		await this.login();
		if (!this.keyDerivParams) { throw new Error(`Error occured in getting key derivation parameters from the server.`); }
		return this.keyDerivParams;
	}

	private async setSessionParams(): Promise<void> {
		let url = this.serviceURI + api.sessionParams.URL_END;
		let rep = await this.doBodylessSessionRequest<api.sessionParams.Reply>({
			path: api.sessionParams.URL_END,
			method: 'GET',
			responseType: 'json'
		});
		if (rep.status !== api.sessionParams.SC.ok) {
			throw makeException(rep, 'Unexpected status');
		}
		if (!keyGen.checkParams(rep.data.keyDerivParams) ||
				(typeof rep.data.maxChunkSize !== 'number') ||
				(rep.data.maxChunkSize < 64*1024)) {
			throw makeException(rep, 'Malformed response');
		}
		this.keyDerivParams = rep.data.keyDerivParams;
		this.maxChunkSize = rep.data.maxChunkSize;
	}
	
	/**
	 * This method hides super from await, till ES7 comes with native support
	 * for await.
	 */
	private super_login(): Promise<void> {
		return super.login();
	}
	
	/**
	 * This does MailerId login with a subsequent getting of session parameters
	 * from 
	 * @return a promise, resolvable, when mailerId login and getting parameters'
	 * successfully completes.
	 */
	async login(): Promise<void> {
		if (!this.isSet) {
			await this.setServiceUrl();
		}
		await this.super_login();
		await this.setSessionParams();
	}
	
	/**
	 * @param objId must be null for root object, and a string id for other ones
	 * @param transParams
	 * @return a promise, resolvable to transaction id.
	 */
	async startTransaction(objId: string,
			transParams: TransactionParams): Promise<api.startTransaction.Reply> {
		let path = ((objId === null) ?
				api.startRootTransaction.URL_END :
				api.startTransaction.getReqUrlEnd(objId));
		let rep = await this.doJsonSessionRequest<api.startTransaction.Reply>({
			path,
			method: 'POST',
			responseType: 'json'
		}, transParams);
		if (rep.status === api.startTransaction.SC.ok) {
			if ((typeof rep.data.transactionId !== 'string')) {
				throw makeException(rep, 'Malformed response');
			}
			return rep.data;
		} else if (rep.status === api.startTransaction.SC.unknownObj) {
			throw makeObjNotFoundExc(objId);
		} else if (rep.status === api.startTransaction.SC.objAlreadyExists) {
			throw makeObjExistsExc(objId);
		} else if (rep.status === api.startTransaction.SC.concurrentTransaction) {
			throw makeConcurrentTransExc(objId);
		} else if (rep.status === api.startTransaction.SC.incompatibleObjState) {
			throw makeWrongStateExc(objId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	/**
	 * @param objId must be null for root object, and a string id for other ones
	 * @param transactionId
	 * @return a promise, resolvable to transaction id.
	 */
	async cancelTransaction(objId: string, transactionId: string):
			Promise<void> {
		let path = ((objId === null) ?
				api.cancelRootTransaction.getReqUrlEnd(transactionId) :
				api.cancelTransaction.getReqUrlEnd(objId, transactionId));
		let rep = await this.doBodylessSessionRequest<void>(
			{ path, method: 'POST' });
		if (rep.status === api.cancelTransaction.SC.ok) {
			return;
		} else if (rep.status === api.cancelTransaction.SC.missing) {
			throw makeUnknownObjOrTransExc(objId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	/**
	 * @param objId must be null for root object, and a string id for other ones
	 * @param transactionId
	 * @return a promise, resolvable to transaction id.
	 */
	async completeTransaction(objId: string, transactionId: string):
			Promise<void> {
		let path = ((objId === null) ?
				api.finalizeRootTransaction.getReqUrlEnd(transactionId) :
				api.finalizeTransaction.getReqUrlEnd(objId, transactionId));
		let rep = await this.doBodylessSessionRequest<void>(
			{ path, method: 'POST' });
		if (rep.status === api.cancelTransaction.SC.ok) {
			return;
		} else if (rep.status === api.cancelTransaction.SC.missing) {
			throw makeUnknownObjOrTransExc(objId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	/**
	 * @param objId
	 * @param ver
	 * @return a promise, resolvable to object with header bytes, object version
	 * of these bytes, and total object segments length.
	 */
	async getObjHeader(objId: string, ver?: number): Promise<{
			segsTotalLen: number; header: Uint8Array; version: number; }> {
		let path = ((objId === null) ?
			api.rootHeader.getReqUrlEnd(ver) :
			api.objHeader.getReqUrlEnd(objId, ver));
		let rep = await this.doBodylessSessionRequest<Uint8Array>({
			path,
			method: 'GET',
			responseType: 'arraybuffer',
			responseHeaders: [ api.HTTP_HEADER.objVersion,
					api.HTTP_HEADER.objSegmentsLength ]
		});
		if (rep.status === api.objSegs.SC.okGet) {
			if (!(rep.data instanceof Uint8Array)) { throw makeException(rep,
				`Malformed response: body is not binary`); }
			let segsTotalLen = parseInt(
				rep.headers!.get(api.HTTP_HEADER.objSegmentsLength)!, 10);
			if (isNaN(segsTotalLen)) { throw makeException(rep,
				`Malformed response: header ${api.HTTP_HEADER.objSegmentsLength} is missing`); }
			if (typeof ver !== 'number') {
				let version = parseInt(rep.headers!.get(
					api.HTTP_HEADER.objVersion)!, 10);
				if (isNaN(version)) { throw makeException(rep,
					`Malformed response: header ${api.HTTP_HEADER.objVersion} is missing`); }
				return { version, segsTotalLen, header: rep.data };
			} else {
				return { version: ver, segsTotalLen, header: rep.data };
			}
		} else if (rep.status === api.objSegs.SC.missing) {
			throw makeObjNotFoundExc(objId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	/**
	 * @param objId
	 * @param ver
	 * @param start
	 * @param end
	 * @return a promise, resolvable to object with segment bytes, and total
	 * object segments length.
	 */
	async getObjSegs(objId: string, ver: number, start: number, end: number):
			Promise<{ segsTotalLen: number; segsChunk: Uint8Array; }> {
		if (end <= start) { throw new Error(`Given out of bounds parameters: start is ${start}, end is ${end}, -- for downloading obj ${objId}, version ${ver}`); }
		let opts: api.GetSegsQueryOpts = { ofs: start, len: end - start };
		let path = ((objId === null) ?
			api.rootSegs.getReqUrlEnd(ver, opts) :
			api.objSegs.getReqUrlEnd(objId, ver, opts));
		let rep = await this.doBodylessSessionRequest<Uint8Array>({
			path,
			method: 'GET',
			responseType: 'arraybuffer',
			responseHeaders: [ api.HTTP_HEADER.objSegmentsLength ]
		});
		if (rep.status === api.objSegs.SC.okGet) {
			let segsTotalLen = parseInt(
				rep.headers!.get(api.HTTP_HEADER.objSegmentsLength)!, 10);
			if (isNaN(segsTotalLen) || !(rep.data instanceof Uint8Array)) {
				throw makeException(rep, 'Malformed response');
			}
			return { segsTotalLen, segsChunk: rep.data };
		} else if (rep.status === api.objSegs.SC.missing) {
			throw makeObjNotFoundExc(objId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	/**
	 * @param objId
	 * @param transactionId
	 * @param bytes is header bytes array
	 * @return a promise, resolvable, when header bytes are saved
	 */
	async saveObjHeader(objId: string, transactionId: string, bytes: Uint8Array):
			Promise<void> {
		let path = ((objId === null) ?
			api.rootHeader.putReqUrlEnd(transactionId) :
			api.objHeader.putReqUrlEnd(objId, transactionId));
		let rep = await this.doBinarySessionRequest<void>(
			{ path, method: 'PUT' }, bytes);
		if (rep.status === api.objHeader.SC.okPut) {
			return;
		} else if (rep.status === api.objHeader.SC.missing) {
			throw makeUnknownObjOrTransExc(objId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	/**
	 * @param objId
	 * @param trans is a transaction id
	 * @param ofs is an offset parameter, identifying where given should be
	 * written
	 * @param bytes is segments bytes array
	 * @param append is an optional parameter, identifying if given write should
	 * be in append mode. Default value is false, i.e. non-appending mode.
	 * @return a promise, resolvable, when header bytes are saved
	 */
	async saveObjSegs(objId: string, trans: string, ofs: number,
			bytes: Uint8Array, append = false): Promise<void> {
		let opts: api.PutSegsQueryOpts = { trans, append, ofs };
		let path = ((objId === null) ?
			api.rootSegs.putReqUrlEnd(opts) :
			api.objSegs.putReqUrlEnd(objId, opts));
		let rep = await this.doBinarySessionRequest<void>(
			{ path, method: 'PUT' }, bytes);
		if (rep.status === api.objSegs.SC.okPut) {
			return;
		} else if (rep.status === api.objSegs.SC.missing) {
			throw makeUnknownObjOrTransExc(objId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
	/**
	 * This deletes object from being available as currently existing one.
	 * But, it does not remove archived versions of it, even if current varsion
	 * has been already archived.
	 * @param objId
	 * @return a promise, resolvable, when an object is deleted.
	 */
	async deleteObj(objId: string): Promise<void> {
		let rep = await this.doBodylessSessionRequest({
			path: api.deleteObj.getReqUrlEnd(objId),
			method: 'DELETE'
		});
		if (rep.status === api.deleteObj.SC.ok) {
			return;
		} else if (rep.status === api.deleteObj.SC.concurrentTransaction) {
			throw makeConcurrentTransExc(objId);
		} else if (rep.status === api.deleteObj.SC.missing) {
			throw makeUnknownObjOrTransExc(objId);
		} else {
			throw makeException(rep, 'Unexpected status');
		}
	}
	
}
Object.freeze(StorageOwner.prototype);
Object.freeze(StorageOwner);

Object.freeze(exports);