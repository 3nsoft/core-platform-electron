/*
 Copyright (C) 2020 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { ExposedFn, Caller, ExposedObj, FileMsg, exposeFileService, ExposedServices, makeFileCaller, FSMsg, exposeFSService, makeFSCaller } from 'core-3nweb-client-lib';
import { ProtoType } from '../ipc-via-protobuf/protobuf-msg';

type Device = NonNullable<web3n.ui.W3N['device']>;

export function exposeDeviceCAP(
	cap: Device, expServices: ExposedServices
): ExposedObj<Device> {
	return {
		openFileDialog: openFileDialog.wrapService(
			cap.openFileDialog, expServices),
		openFolderDialog: openFolderDialog.wrapService(
			cap.openFolderDialog, expServices),
		saveFileDialog: saveFileDialog.wrapService(
			cap.saveFileDialog, expServices),
		saveFolderDialog: saveFolderDialog.wrapService(
			cap.saveFolderDialog, expServices)
	};
}

export function makeDeviceCaller(
	caller: Caller, objPath: string[]
): Device {
	return {
		openFileDialog: openFileDialog.makeCaller(caller, objPath),
		openFolderDialog: openFolderDialog.makeCaller(caller, objPath),
		saveFileDialog: saveFileDialog.makeCaller(caller, objPath),
		saveFolderDialog: saveFolderDialog.makeCaller(caller, objPath)
	};
}


function deviceType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('device.proto', `device.${type}`);
}


type FileTypeFilter = web3n.device.files.FileTypeFilter;

interface SaveDialogArgs {
	title: string;
	btnLabel: string;
	defaultPath: string;
	filters?: FileTypeFilter[];
}
const saveDialogArgsType = deviceType<SaveDialogArgs>('SaveDialogArgs');


namespace saveFileDialog {

	interface Reply {
		file?: FileMsg;
	}

	const replyType = deviceType<Reply>('SaveFileDialogReplyBody');

	export function wrapService(
		fn: Device['saveFileDialog'], expServices: ExposedServices
	): ExposedFn {
		return bytes => {
			const { btnLabel, defaultPath, title, filters } =
				saveDialogArgsType.unpack(bytes);
			const promise = fn(title, btnLabel, defaultPath, filters)
			.then(fileObj => {
				const file = (fileObj ?
					exposeFileService(fileObj, expServices) : undefined);
				return replyType.pack({ file });
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Device['saveFileDialog'] {
		const path = objPath.concat('saveFileDialog');
		return async (title, btnLabel, defaultPath, filters) => {
			const req = saveDialogArgsType.pack({
				title, btnLabel, defaultPath, filters
			});
			const buf = await caller.startPromiseCall(path, req);
			const reply = replyType.unpack(buf);
			return (reply.file ?
				makeFileCaller(caller, reply.file) as web3n.files.WritableFile :
				undefined);
		};
	}

}
Object.freeze(saveFileDialog);


namespace saveFolderDialog {

	interface Reply {
		folder?: FSMsg;
	}

	const replyType = deviceType<Reply>('SaveFolderDialogReplyBody');

	export function wrapService(
		fn: Device['saveFolderDialog'], expServices: ExposedServices
	): ExposedFn {
		return bytes => {
			const { btnLabel, defaultPath, title, filters } =
				saveDialogArgsType.unpack(bytes);
			const promise = fn(title, btnLabel, defaultPath, filters)
			.then(fsObj => {
				const folder = (fsObj ?
					exposeFSService(fsObj, expServices) : undefined);
				return replyType.pack({ folder });
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Device['saveFolderDialog'] {
		const path = objPath.concat('saveFolderDialog');
		return async (title, btnLabel, defaultPath, filters) => {
			const req = saveDialogArgsType.pack({
				title, btnLabel, defaultPath, filters
			});
			const buf = await caller.startPromiseCall(path, req);
			const reply = replyType.unpack(buf);
			return (reply.folder ?
				makeFSCaller(caller, reply.folder) as web3n.files.WritableFS :
				undefined);
		};
	}

}
Object.freeze(saveFolderDialog);


interface OpenDialogArgs {
	title: string;
	btnLabel: string;
	multiSelections: boolean;
	filters?: FileTypeFilter[];
}
const openDialogArgsType = deviceType<OpenDialogArgs>('OpenDialogArgs');


namespace openFileDialog {

	interface Reply {
		files?: FileMsg[];
	}

	const replyType = deviceType<Reply>('OpenFileDialogReplyBody');

	export function wrapService(
		fn: Device['openFileDialog'], expServices: ExposedServices
	): ExposedFn {
		return bytes => {
			const { btnLabel, multiSelections, title, filters } =
				openDialogArgsType.unpack(bytes);
			const promise = fn(title, btnLabel, multiSelections, filters)
			.then(fileObjs => {
				const files = (fileObjs ?
					fileObjs.map(f => exposeFileService(f, expServices)) :
					undefined);
				return replyType.pack({ files });
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Device['openFileDialog'] {
		const path = objPath.concat('openFileDialog');
		return async (title, btnLabel, multiSelections, filters) => {
			const req = openDialogArgsType.pack({
				title, btnLabel, multiSelections, filters
			});
			const buf = await caller.startPromiseCall(path, req);
			const reply = replyType.unpack(buf);
			if (reply.files && (reply.files.length > 0)) {
				return reply.files.map(fMsg => makeFileCaller(caller, fMsg));
			} else {
				return undefined;
			}
		};
	}

}
Object.freeze(openFileDialog);


namespace openFolderDialog {

	interface Reply {
		folders?: FSMsg[];
	}

	const replyType = deviceType<Reply>('OpenFolderDialogReplyBody');

	export function wrapService(
		fn: Device['openFolderDialog'], expServices: ExposedServices
	): ExposedFn {
		return bytes => {
			const { btnLabel, multiSelections, title, filters } =
				openDialogArgsType.unpack(bytes);
			const promise = fn(title, btnLabel, multiSelections, filters)
			.then(fsObjs => {
				const folders = (fsObjs ?
					fsObjs.map(f => exposeFSService(f, expServices)) :
					undefined);
				return replyType.pack({ folders });
			});
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): Device['openFolderDialog'] {
		const path = objPath.concat('openFolderDialog');
		return async (title, btnLabel, multiSelections, filters) => {
			const req = openDialogArgsType.pack({
				title, btnLabel, multiSelections, filters
			});
			const buf = await caller.startPromiseCall(path, req);
			const reply = replyType.unpack(buf);
			if (reply.folders && (reply.folders.length > 0)) {
				const folders = reply.folders.map(
					fsMsg => makeFSCaller(caller, fsMsg));
				return folders as web3n.files.WritableFS[];
			} else {
				return undefined;
			}
		};
	}

}
Object.freeze(openFolderDialog);


Object.freeze(exports);