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

import { StorageOwner } from '../../../lib-client/3nstorage/service';
import { Subscription } from 'rxjs';
import { objChanged, objRemoved }
	from '../../../lib-common/service-api/3nstorage/owner';
import { logError } from '../../../lib-client/logging/log-to-file';
import { ServerEvents } from '../../../lib-client/server-events';
import { Node } from '../../../lib-client/3nstorage/xsp-fs/common';
import { SyncedObjVersions, ObjId } from './files/objs';
import { ObjProc } from './obj-procs/obj-proc';

/**
 * Instance of this interface observes storage server events and handles them.
 * Note that fs nodes propagate their own events.
 */
export interface StorageEventsProc {
	close(): void;
}

/**
 * This returns an already started processing of storage events.
 * @param isObjProcActive
 * @param remoteStorage 
 */
export function makeStorageEventsProc(remoteStorage: StorageOwner,
		getObjProc: (objId: ObjId) => ObjProc|undefined,
		getCurrentNode: (objId: ObjId) => Node|undefined,
		files: SyncedObjVersions): StorageEventsProc {

	const serverEvents = new ServerEvents(
		() => remoteStorage.openEventSource());
	
	const objChange$ = serverEvents.observe<objChanged.Event>(
		objChanged.EVENT_NAME)
	.flatMap(async objChange => {
		const objProc = getObjProc(objChange.objId);
		if (objProc) {
			objProc.handleRemoteObjChange(objChange);
		} else {
			const newVersionSet = await files.setCurrentRemoteVersion(
				objChange.objId, objChange.newVer);
			if (newVersionSet) {
				const node = getCurrentNode(objChange.objId);
				if (node) {
					node.absorbExternalChange();
				}
			}
		}
		return objChange;
	})
	.do(undefined as any, err => logError(err,
		`Failed on processing a stream of storage server events ${objChanged.EVENT_NAME}`));
	
	const objRemoval$ = serverEvents.observe<objRemoved.Event>(
		objRemoved.EVENT_NAME)
	.flatMap(async objRm => {
		const objProc = getObjProc(objRm.objId);
		if (objProc) {
			objProc.handleRemoteObjRemoval(objRm);
		} else {
			const node = getCurrentNode(objRm.objId);
			if (node) {
				await node.delete(true);
			}
			await files.removeCurrentObjVersion(objRm.objId);
		}
		return objRm;
	})
	.do(undefined as any, err => logError(err,
		`Failed on processing a stream of storage server events ${objRemoved.EVENT_NAME}`));
	
	let proc: Subscription|undefined = objChange$
	.merge(objRemoval$)
	.retry(2)
	.subscribe(undefined,
		() => { proc = undefined; },
		() => { proc = undefined; });

	return {
		close(): void {
			if (proc) {
				proc.unsubscribe();
				proc = undefined;
			}
		}
	};
}

Object.freeze(exports);