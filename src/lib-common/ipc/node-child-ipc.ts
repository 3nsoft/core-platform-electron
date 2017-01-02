/*
 Copyright (C) 2016 3NSoft Inc.
 
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


import * as cProcs from 'child_process';
import { Duplex, CommunicationPoint } from './generic-ipc';

export { Duplex, RequestEnvelope, RequestHandler, EventEnvelope, EventListener }
	from './generic-ipc';

export function commToChild(channel: string, child: cProcs.ChildProcess):
		Duplex {
	let envListener: (r: any) => void;
	let nodeListener = (r: any) => {
		if (envListener) { envListener(r); }
	};
	let commPoint: CommunicationPoint = {
		addListener(listener: (r: any) => void): () => void {
			if (envListener) { throw new Error(
				'Envelope listener has already been added.'); }
			envListener = listener;
			child.on('message', nodeListener);
			return () => {
				envListener = (undefined as any);
				child.removeListener('message', nodeListener);
			};
		},
		postMessage(env: any): void {
			child.send(env);
		}
	};
	return new Duplex(channel, commPoint);
}

export function commToParent(channel: string): Duplex {
	let envListener: (r: any) => void;
	let nodeListener = (r: any) => {
		if (envListener) { envListener(r); }
	};
	let commPoint: CommunicationPoint = {
		addListener(listener: (r: any) => void): () => void {
			if (envListener) { throw new Error(
				'Envelope listener has already been added.'); }
			envListener = listener;
			process.on('message', nodeListener);
			return () => {
				envListener = (undefined as any);
				process.removeListener('message', nodeListener);
			};
		},
		postMessage(env: any): void {
			process.send!(env);
		}
	};
	return new Duplex(channel, commPoint);
}

Object.freeze(exports);