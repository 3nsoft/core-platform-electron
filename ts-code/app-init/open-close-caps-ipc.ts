/*
 Copyright (C) 2020 - 2021 3NSoft Inc.
 
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

import { ExposedFn, Caller, ExposedServices } from 'core-3nweb-client-lib';
import { ProtoType, Value, toOptVal, ObjectReference } from '../ipc-via-protobuf/protobuf-msg';

type CloseSelf = NonNullable<web3n.ui.W3N['closeSelf']>;


export namespace closeSelf {

	export function expose(fn: CloseSelf): ExposedFn {
		return () => fn();
	}

	export function makeClient(caller: Caller, objPath: string[]): CloseSelf {
		return () => {
			caller.startPromiseCall(objPath, undefined);
		};
	}

}
Object.freeze(closeSelf);


function openerType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('openclose.proto', `openclose.${type}`);
}

type OpenChildWindow = web3n.ui.OpenChildWindow;


export namespace openChildWindow {

	export function expose(fn: OpenChildWindow): ExposedFn {

		// XXX implementation is missing

		return bytes => {};
	}

	export function makeClient(
		caller: Caller, objPath: string[]
	): OpenChildWindow {
		return (subroot, path, opts, setRPC, caps) => {

			// XXX implementation is missing

			throw new Error(`Wrapper is not implemented`);
		};
	}

}
Object.freeze(openChildWindow);


type OpenViewer = web3n.ui.OpenViewer;
type WindowOptions = web3n.ui.WindowOptions;
interface WindowOptionsMsg {
	width?: Value<number>;
	height?: Value<number>;
	x?: Value<number>;
	y?: Value<number>;
	useContentSize?: Value<boolean>;
	center?: Value<boolean>;
	minWidth?: Value<number>;
	minHeight?: Value<number>;
	maxWidth?: Value<number>;
	maxHeight?: Value<number>;
	resizable?: Value<boolean>;
	movable?: Value<boolean>;
	minimizable?: Value<boolean>;
	maximizable?: Value<boolean>;
	skipTaskbar?: Value<boolean>;
	title?: Value<string>;
	icon?: Value<string>;
	frame?: Value<boolean>;
	alwaysAboveParent?: Value<boolean>;
	modal?: Value<boolean>;
	acceptFirstMouse?: Value<boolean>;
	backgroundColor?: Value<string>;
	titleBarStyle?: Value<string>;
	thickFrame?: Value<boolean>;
}

function packWindowOptions(opts: WindowOptions): WindowOptionsMsg {
	const msg: WindowOptionsMsg = {};
	for (const [field, val] of Object.entries(opts)) {
		msg[field] = toOptVal(val);
	}
	return msg;
}

function unpackWindowOptions(msg: WindowOptionsMsg): WindowOptions {
	const opts: WindowOptions = {};
	for (const [field, val] of Object.entries(msg)) {
		if (val) {
			opts[field] = (val as Value<any>).value;
		}
	}
	return opts;
}


export namespace openViewer {

	interface Request {
		fs: ObjectReference;
		path: string;
		itemType: string;
		opts?: WindowOptionsMsg;
	}

	const requestType = openerType<Request>('OpenViewerRequestBody');

	export function expose(
		fn: OpenViewer, expServices: ExposedServices
	): ExposedFn {
		return bytes => {
			const { fs, itemType, path, opts } = requestType.unpack(bytes);
			const promise = fn(
				expServices.getOriginalObj(fs),
				path, itemType as any,
				(opts ? unpackWindowOptions(opts) : undefined)
			);
			return { promise };
		};
	}

	export function makeClient(caller: Caller, objPath: string[]): OpenViewer {
		return async (fs, path, itemType, opts) => {
			const req: Request = {
				fs: caller.srvRefOf(fs),
				path, itemType,
				opts: (opts ? packWindowOptions(opts) : undefined)
			};
			await caller.startPromiseCall(objPath, requestType.pack(req));
		};
	}

}
Object.freeze(openViewer);


type OpenWithOSApp = web3n.ui.OpenWithOSApp;


export namespace openWithOSApp {

	interface Request {
		folder?: ObjectReference;
		file?: ObjectReference;
	}

	interface Reply {
		opened: boolean;
	}

	const requestType = openerType<Request>('OpenWithOSAppRequestBody');
	const replyType = openerType<Reply>('OpenWithOSAppReplyBody');

	export function expose(
		fn: OpenWithOSApp, expServices: ExposedServices
	): ExposedFn {
		return bytes => {
			const { file, folder } = requestType.unpack(bytes);
			const promise = fn(file ?
				expServices.getOriginalObj(file) :
				expServices.getOriginalObj(folder!))
			.then(opened => { opened });
			return { promise };
		};
	}

	export function makeClient(
		caller: Caller, objPath: string[]
	): OpenWithOSApp {
		return async f => {
			const ref = caller.srvRefOf(f);
			const req: Request = (f['readonlySubRoot'] ?
				{ folder: ref } : { file: ref });
			const bytes = await caller.startPromiseCall(
				objPath, requestType.pack(req));
			const reply = replyType.unpack(bytes);
			return reply.opened;
		};
	}

}
Object.freeze(openWithOSApp);


type OpenWithOSBrowser = web3n.ui.OpenWithOSBrowser;


export namespace openWithOSBrowser {

	interface Request {
		url: string;
	}

	const requestType = openerType<Request>('OpenWithOSBrowserRequestBody');

	export function expose(fn: OpenWithOSBrowser): ExposedFn {
		return bytes => {
			const { url } = requestType.unpack(bytes);
			fn(url);
		};
	}

	export function makeClient(
		caller: Caller, objPath: string[]
	): OpenWithOSBrowser {
		return url => {
			const req = requestType.pack({ url });
			caller.startPromiseCall(objPath, req);
		};
	}

}
Object.freeze(openWithOSBrowser);


Object.freeze(exports);