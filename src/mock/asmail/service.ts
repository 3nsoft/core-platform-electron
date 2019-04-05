/*
 Copyright (C) 2016 - 2017 3NSoft Inc.
 
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

import { sleep } from '../../lib-common/processes';
import { bind } from '../../lib-common/binding';
import { DeliveryMock } from './delivery';
import { InboxMock } from './inbox';
import { ASMailMockConfig } from '../conf';
import { ServiceWithInitPhase } from './common';

type ASMailService = web3n.asmail.Service;

export class ASMailMock extends ServiceWithInitPhase implements ASMailService {
	
	private userId: string = (undefined as any);
	delivery = new DeliveryMock();
	inbox = new InboxMock();
	
	constructor() {
		super()
		Object.seal(this);
	}
	
	async initFor(userId: string, config: ASMailMockConfig):
			Promise<void> {
		try {
			this.userId = userId;
			await this.delivery.initFor(userId, config);
			await this.inbox.initFor(userId, config);
			this.initializing.resolve();
			this.initializing = (undefined as any);
		} catch (e) {
			this.initializing.reject(e);
			throw e;
		}
	}
	
	async getUserId(): Promise<string> {
		if (this.initializing) { await this.initializing.promise; }
		await sleep(0);
		return this.userId;
	}
	
	makeASMailCAP = (): ASMailService => {
		const w: ASMailService = {
			getUserId: bind(this, this.getUserId),
			delivery: this.delivery.wrap(),
			inbox: this.inbox.wrap(),
		};
		Object.freeze(w);
		return w;
	};
	
}
Object.freeze(ASMailMock.prototype);
Object.freeze(ASMailMock);

Object.freeze(exports);