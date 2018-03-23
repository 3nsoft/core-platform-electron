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

import { SubscribingClient } from '../lib-common/ipc/generic-ipc';
import { Observable } from 'rxjs';
import { SingleProc } from '../lib-common/processes';

export class ServerEvents {

	private server: SubscribingClient|undefined = undefined;
	private openningServer = new SingleProc();
	
	constructor(
			private subscribeToServer: () => Promise<SubscribingClient>) {
		Object.seal(this);
	}

	/**
	 * This method creates an observable of server's events.
	 * @param serverEvent is an event on server, to which to subscribe.
	 */
	observe<T>(event: string): Observable<T> {
		return new Observable<T>(observer => {
			// simple sync creation of detach function
			if (this.server) {
				return this.server.subscribe(event, observer);
			}

			// detach function that works around of async creation of event source
			if (!this.openningServer.getP()) {
				this.openningServer.addStarted(this.subscribeToServer());
			}
			let detach: (() => void)|undefined;
			let obs: (typeof observer)|undefined = observer;
			this.openningServer.getP<SubscribingClient>()!.then((server) => {
				this.server = server;
				if (!obs) { return; }
				detach = this.server.subscribe(event, obs);
			});
			return () => {
				if (detach) {
					detach();
				} else {
					obs = undefined;
				}
			};
		});
	}

}
Object.freeze(ServerEvents.prototype);
Object.freeze(ServerEvents);

Object.freeze(exports);