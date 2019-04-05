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

import { AppInstance } from '../ui/app-instance';
import { bind } from '../lib-common/binding';
import { CAPs } from './core';
import { makeDeviceFileOpener } from './device';
import { makeRPCLink } from '../lib-common/apps-rpc/core-side';

type ChildWindow = web3n.ui.ChildWindow;
type OpenChildAppWindow = web3n.ui.OpenChildWindow;
type RPC = web3n.rpc.RPC;
type W3N = web3n.ui.W3N;

export interface ChildOpener {
	remotedCAP: OpenChildAppWindow;
	setAppInstance(app: AppInstance): void;
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
			setAppInstance: bind(this, this.setAppInstance),
			close: (): void => {
				this.app = undefined;
			},
			remotedCAP: bind(this, this.makeChild)
		};
		return Object.freeze(w);
	}

	private setAppInstance(app: AppInstance): void {
		if (this.app) { throw new Error(`App instance is already set`); }
		this.app = app;
	}

	private async makeChild(subroot: string|null, path: string,
			winOpts: web3n.ui.WindowOptions, setRPC?: boolean, passedCAPS?: W3N):
			Promise<ChildWindow> {
		if (!this.app) { throw new Error(
			`Capability to create child app is not enabled.`); }

		const childCAPs = this.adaptCAPsTransferedToChild(passedCAPS);
		let childRPC: RPC|undefined;
		if (setRPC === true) {
			childRPC = addParentCAP(childCAPs);
		}
		
		Object.freeze(childCAPs.remotedW3N);
		Object.freeze(childCAPs);

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

	private adaptCAPsTransferedToChild(passedCAPS: W3N|undefined): CAPs {
		const childCAPs = makeCAPsWithCloseSelf();
		if (!passedCAPS) { return childCAPs; }

		const ownW3N = this.app!.remotedW3N;

		if (passedCAPS.device && (passedCAPS.device === ownW3N.device)) {
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

function addDeviceFileOpenerCAP(childCAPs: CAPs): void {
	const deviceFileOpener = makeDeviceFileOpener();
	childCAPs.remotedW3N.device = deviceFileOpener.remotedCAP;
	addOnClose(childCAPs, deviceFileOpener.close);
	callBackOnAppSetting(childCAPs, deviceFileOpener.setAppInstance);
}

function addChildWindowOpenerCAP(childCAPs: CAPs): void {
	const childOpener = makeChildOpener();
	childCAPs.remotedW3N.openChildWindow = childOpener.remotedCAP;
	addOnClose(childCAPs, childOpener.close);
	callBackOnAppSetting(childCAPs, childOpener.setAppInstance);
}

/**
 * This method adds a 'parent' capability to given child caps, returning
 * an rpc link object that will be wrapped into rpc object by preload side.
 * @param childCAPs 
 */
function addParentCAP(childCAPs: CAPs): RPC {
	const rpcLink = makeRPCLink();
	addOnClose(childCAPs, rpcLink.close);
	childCAPs.remotedW3N.parent = rpcLink as any;
	return rpcLink as any;
}

function makeCAPsWithCloseSelf(): CAPs {
	let self: AppInstance = undefined as any;
	return {
		close: () => {},
		remotedW3N: {
			closeSelf: () => self.window.close()
		},
		setAppInstance: app => { self = app; },
	};
}

function callBackOnAppSetting(childCAPs: CAPs,
		onAppSet: (app: AppInstance) => void): void {
	childCAPs.setAppInstance = chainFn(childCAPs.setAppInstance!, onAppSet);
}

function addOnClose(childCAPs: CAPs, close: () => void): void {
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