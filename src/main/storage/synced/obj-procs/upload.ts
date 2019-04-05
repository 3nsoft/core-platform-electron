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

import { Observable } from 'rxjs';
import { StorageException } from '../../../../lib-client/3nstorage/exceptions';
import { ConnectException } from '../../../../lib-common/exceptions/http';
import { StorageOwner as RemoteStorageOwner, FollowingSaveReqOpts,
	FirstSaveReqOpts }
	from '../../../../lib-client/3nstorage/service';
import { logWarning } from '../../../../lib-client/logging/log-to-file';
import { ObjId } from '../files/objs';
import { LocalObjVersions, UploadInfo } from '../files/local-versions';
import { ReadingProc } from './stream-for-upload';

export function uploadProc(remoteStorage: RemoteStorageOwner,
		files: LocalObjVersions, objId: ObjId, ver: number, data: ReadingProc):
		Promise<void> {
	let uploadInfo: UploadInfo|undefined = undefined;
	
	const promise = makeUploadProcSection(objId, ver, data, remoteStorage)
	.flatMap(async info => {
		uploadInfo = info;
		await files.saveUploadInfo(objId, ver, uploadInfo);
	}, 1)
	.catch(async (exc: StorageException) => {
		if ((exc.type === 'storage') && (exc.unknownTransaction)) {
			await files.clearUploadInfo(objId, ver);
		}
		throw exc;
	})
	.toPromise();
	
	// should start reading after an implicit subscription @ toPromise
	data.readNext();
	
	return promise;
}

function makeUploadProcSection(objId: ObjId, ver: number, data: ReadingProc,
		remoteStorage: RemoteStorageOwner): Observable<UploadInfo> {
	let append = false;
	let transactionId: string|undefined = undefined;

	return data.chunk$
	.flatMap(async c => {
		if (!c.last) { data.readNext(); }

		if (c.transactionId) {
			transactionId = c.transactionId;
		}
		
		if (c.fst) {

			append = (typeof c.fst.segsLen !== 'number');

			const opts: FirstSaveReqOpts = {
				ver, header: c.fst.header, diff: c.fst.diff };
			if (append) {
				opts.append = true;
			} else {
				opts.segs = c.fst.segsLen;
			}

			transactionId = await remoteStorage.saveNewObjVersion(objId,
				c.bytes, opts, undefined);

		} else if (transactionId) {

			const opts: FollowingSaveReqOpts = { trans: transactionId };
			if (append) {
				opts.append = true;
			} else {
				opts.ofs = c.segsOfs;
			}
			if (c.last) {
				opts.last = true;
			}

			transactionId = await remoteStorage.saveNewObjVersion(
				objId, c.bytes, undefined, opts)
			.catch(async (exc: ConnectException) => {
				if (exc.type !== 'http-connect') {
					await remoteStorage.cancelTransaction(objId, transactionId!)
					.catch(e => logWarning(
						`Cannot cancel transaction on object ${objId}`, e));
				}
				throw exc;
			});

		} else {
			throw new Error(`This is not the first object upload request, but transaction id is missing;`);
		}

		const uploadInfo: UploadInfo = {
			transactionId,
			done: c.last,
			segsUploaded: c.segsOfs + c.segs
		};
		return uploadInfo;
	}, 1);	// note: concurrency is set to 1 here
}

Object.freeze(exports);