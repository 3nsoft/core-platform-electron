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

import { sleep, defer } from '../../lib-common/processes';

export const ASMAIL_CORE_APP = 'computer.3nweb.core.asmail';

export const MSGS_FOLDER = 'msgs';
export const MAIN_MSG_OBJ = 'main.json';
export const ATTACHMENTS_FOLDER = 'attachments';

export abstract class ServiceWithInitPhase {

	protected initializing = defer<void>();

	protected async delayRequest(millis?: number): Promise<void> {
		if (this.initializing) { await this.initializing.promise; }
		if (typeof millis === 'number') {
			await sleep(millis);
		} else {
			await sleep(0);
		}
	}

}
Object.freeze(ServiceWithInitPhase.prototype);
Object.freeze(ServiceWithInitPhase);
