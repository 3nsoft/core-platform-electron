/*
 Copyright (C) 2017 - 2018, 2020 - 2021 3NSoft Inc.

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

import { AppInstance } from './app-instance';
import { makeDeviceFileOpener } from '../device';
import { AppCAPsAndSetup } from '../core/core-driver';
// XXX comment out till rpc will be done
// import { makeRPCLink } from '../lib-common/apps-rpc/core-side';

type ChildWindow = web3n.ui.ChildWindow;
type OpenChildAppWindow = web3n.ui.OpenChildWindow;
type RPC = web3n.rpc.RPC;
type W3N = web3n.ui.W3N;

export interface ChildOpener {
	cap: OpenChildAppWindow;
	setApp(app: AppInstance): void;
	close(): void;
}

export function makeChildOpener(): ChildOpener {
	return (new ChildAppOpener()).wrap();
}

class ChildAppOpener {

	private app: AppInstance|undefined = undefined;

	constructor() {
		Object.seal(this);
	}

	wrap(): ChildOpener {
		const w: ChildOpener = {
			setApp: this.setApp.bind(this),
			close: (): void => {
				this.app = undefined;
			},
			cap: this.makeChild.bind(this)
		};
		return Object.freeze(w);
	}

	private setApp(app: AppInstance): void {
		if (this.app) { throw new Error(`App instance is already set`); }
		this.app = app;
	}

	private async makeChild(
		subroot: string|null, path: string, winOpts: web3n.ui.WindowOptions,
		setRPC: boolean|undefined, passedCAPS: W3N|undefined
	): Promise<ChildWindow> {
		if (!this.app) { throw new Error(
			`Capability to create child app is not enabled.`); }

		const childCAPs = this.adaptCAPsTransferedToChild(passedCAPS);
		let childRPC: RPC|undefined;
		if (setRPC === true) {
			childRPC = addParentCAP(childCAPs);
		}
		
		const childApp = await this.app.makeChildInWindow(
			subroot, childCAPs, winOpts);
		childApp.loadContent(path);
		
		const child: ChildWindow = {
			destroy: () => childApp.window.destroy()
		};
		if (childRPC) {
			child.rpc = childRPC;
		}
		return Object.freeze(child);
	}

	private adaptCAPsTransferedToChild(
		passedCAPS: W3N|undefined
	): AppCAPsAndSetup {
		const childCAPs = makeCAPsWithCloseSelf();
		if (!passedCAPS) { return childCAPs; }

		const ownW3N = this.app!.w3n;

		if (passedCAPS.device
		&& (passedCAPS.device === ownW3N.device)) {
			addDeviceFileOpenerCAP(childCAPs);
		}

		if (passedCAPS.openChildWindow
		&& (passedCAPS.openChildWindow === ownW3N.openChildWindow)) {
			addChildWindowOpenerCAP(childCAPs);
		}

		return childCAPs;
	}

}
Object.freeze(ChildAppOpener.prototype);
Object.freeze(ChildAppOpener);

function addDeviceFileOpenerCAP(childCAPs: AppCAPsAndSetup): void {
	const deviceFileOpener = makeDeviceFileOpener();
	childCAPs.w3n.device = deviceFileOpener.cap;
	addOnClose(childCAPs, deviceFileOpener.close);
	callBackOnAppSetting(childCAPs, deviceFileOpener.setApp);
}

function addChildWindowOpenerCAP(childCAPs: AppCAPsAndSetup): void {
	const childOpener = makeChildOpener();
	childCAPs.w3n.openChildWindow = childOpener.cap;
	addOnClose(childCAPs, childOpener.close);
	callBackOnAppSetting(childCAPs, childOpener.setApp);
}

/**
 * This method adds a 'parent' capability to given child caps, returning
 * an rpc link object that will be wrapped into rpc object by preload side.
 * @param childCAPs 
 */
function addParentCAP(childCAPs: AppCAPsAndSetup): RPC {
	throw new Error(`Link between apps is not implemented, and CAP can't be initialized`);
	// XXX
	// const rpcLink = makeRPCLink();
	// addOnClose(childCAPs, rpcLink.close);
	// childCAPs.w3n.parent = rpcLink as any;
	// return rpcLink as any;
}

function makeCAPsWithCloseSelf(): AppCAPsAndSetup {
	let self: AppInstance = undefined as any;
	return {
		close: () => {},
		w3n: {
			closeSelf: () => self.window.close()
		},
		setApp: app => { self = app; },
	};
}

function callBackOnAppSetting(
	childCAPs: AppCAPsAndSetup, onAppSet: (app: AppInstance) => void
): void {
	childCAPs.setApp = chainFn(childCAPs.setApp, onAppSet);
}

function addOnClose(childCAPs: AppCAPsAndSetup, close: () => void): void {
	childCAPs.close = (childCAPs.close ?
		chainFn(childCAPs.close, close) : close);
}

function chainFn<T extends Function>(original: T, tail: T): T {
	return function() {
		original(...arguments);
		tail(...arguments);
	} as any as T;
}

Object.freeze(exports);