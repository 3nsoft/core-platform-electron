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


import { RuntimeException } from '../exceptions/runtime';
import { ErrorWithCause } from '../exceptions/error';
import { bind } from '../binding';
import { uint48 } from '../../lib-client/random-node';

export interface WorkerError {
	name?: string;
	message: string;
	stack?: string;
	cause?: any;
}

function toWorkerError(e: ErrorWithCause): WorkerError {
	let err: WorkerError = {
		message: e.message,
		name: e.name,
		stack: e.stack,
	};
	if (e.cause) {
		if ((typeof e.cause !== 'object') ||
				(e.cause as any as RuntimeException).runtimeException) {
			err.cause = e.cause;
		} else {
			err.cause = toWorkerError(e.cause);
		}
	}
	return err;
}

export interface Envelope {
	type: 'request' | 'reply' | 'event';
}

export interface RequestEnvelope<T> extends Envelope {
	name: string;
	count: number;
	req: T;
}

export interface ReplyEnvelope<T> extends Envelope {
	reqName: string;
	reqCount: number;
	isInProgress?: boolean;
	rep: T|null;
	err?: WorkerError|RuntimeException;
}

export interface EventEnvelope<T> extends Envelope {
	eventChannel: string;
	eventPayload: T;
}

export interface EventListener<T> {
	(event: EventEnvelope<T>): void;
}

export interface CommunicationPoint {
	
	/**
	 * This sends a given envelope to the other side of ipc.
	 * @param env
	 */
	postMessage(env: Envelope): void;
	
	/**
	 * This adds listener for receiving envelopes from the other side of ipc.
	 * @param listener
	 * @return a listener detaching function, which should be used when closing
	 * this ipc channel.
	 */
	addListener(listener: (r: Envelope) => void): () => void;
}

export interface RequestHandler<TReq, TRes> {
	(env: RequestEnvelope<TReq>): Promise<TRes>|void;
}

interface Deferred {
	resolve(result?: any): void;
	reject(cause: any): void;
	notify(progress: any): void;
}

export class Duplex {
	
	private counter = 0;
	private replyDeferreds = new Map<number, Deferred>();
	private requestHandlers = new Map<string, RequestHandler<any, any>>();
	private detachFromComm: () => void;

	/**
	 * This is a set of known inbound event channels (as map keys), with related
	 * sets of registered listeners (as map values).
	 */
	private inboundEventChannels =
		new Map<string, Map<number, EventListener<any>>>();
	
	constructor(
			private channel: string|undefined,
			private comm: CommunicationPoint) {
		this.detachFromComm = this.comm.addListener(bind(this, this.handleMsg));
		Object.seal(this);
	}
	
	private handleRequest(env: RequestEnvelope<any>): void {
		if (this.channel && (env.name.indexOf(this.channel) !== 0)) { return; }
		let handler = this.requestHandlers.get(env.name);
		if (!handler) {
			this.processHandleError(env, new Error(
				`Have no handler for request named ${env.name}`));
			return;
		}
		try {
			let promise = handler(env);
			if (!promise) {
				this.replyToRequest(env, null);
				return;
			}
			(<Promise<any>> promise)
			.then((res) => {
				this.replyToRequest(env, res);
			})
			.catch((err) => {
				this.processHandleError(env, err);
			});
		} catch (err) {
			this.processHandleError(env, err);
		}
	}
	
	private processHandleError(env: RequestEnvelope<any>,
			err: Error|RuntimeException): void {
		if (err === null) { return; }
		let reply: ReplyEnvelope<any> =  {
			type: 'reply',
			reqName: env.name,
			reqCount: env.count,
			rep: null
		};
		if ((<RuntimeException> err).runtimeException) {
			reply.err = err;
		} else {
			reply.err = toWorkerError(<ErrorWithCause> err);
		}
		this.comm.postMessage(reply);
	}
	
	private handleReply(env: ReplyEnvelope<any>): void {
		if (this.channel && (env.reqName.indexOf(this.channel) !== 0)) { return; }
		let deferredReply = this.replyDeferreds.get(env.reqCount);
		if (!deferredReply) { return; }
		if (env.isInProgress) {
			deferredReply.notify(env.rep)
		} else {
			if (env.err) {
				deferredReply.reject(env.err);
			} else {
				deferredReply.resolve(env.rep);
			}
			this.replyDeferreds.delete(env.reqCount);
		}
	}
	
	private handleMsg(r: Envelope): void {
		if (r.type === 'reply') {
			this.handleReply(r as ReplyEnvelope<any>);
		} else if (r.type === 'request') {
			this.handleRequest(r as RequestEnvelope<any>);
		} else if (r.type === 'event') {
			this.handleInboundEvent(r as EventEnvelope<any>);
		} else {
			console.error(`Got malformed message: ${JSON.stringify(r)}`);
		}
	}
	
	/**
	 * This rejects all pending request, clearing internal containers.
	 */
	private rejectAndClearPendingRequests(): void {
		for (let reqNum of this.replyDeferreds.keys()) {
			if (isNaN(reqNum)) { continue; }
			let deferred = this.replyDeferreds.get(reqNum);
			if (!deferred) { continue; }
			deferred.reject(new Error('All pending requests are flushed.'));
		}
		this.replyDeferreds.clear();
	}

	private dropAllListeners(): void {
		for (let listeners of this.inboundEventChannels.values()) {
			listeners.clear();
		}
	}
	
	close() {
		this.comm = (undefined as any);
		this.rejectAndClearPendingRequests();
		this.dropAllListeners();
		this.detachFromComm();
	}

	/**
	 * This is a generic method with first type T being a type of a final reply,
	 * and second type P being a type of in-progress replies.
	 * @param reqName is a name of this request, sort of like a function name
	 * @param req is a request object that is sent to worker in the message
	 * @return a promise, resolvable to a reply that other side sends back, when
	 * it completes a request.
	 */
	makeRequest<T>(reqName: string, req: any,
			notifyCallback?: (progress: any) => void): Promise<T> {
		if (!this.comm) { throw new Error(
			'Cannot make a request, cause ipc point is not connected.'); }
		this.counter += 1;
		let envelope: RequestEnvelope<any> = {
			type: 'request',
			name: (this.channel ? `${this.channel}/${reqName}` : reqName),
			count: this.counter,
			req: req
		};
		this.comm.postMessage(envelope);
		return new Promise<T>((resolve, reject) => {
			let deferredReply: Deferred = {
				resolve, reject,
				notify: (notifyCallback ? notifyCallback : () => {})
			}
			this.replyDeferreds.set(this.counter, deferredReply)
		});
	}
	
	/**
	 * @param reqName is a name of request, to be handled by a given handler
	 * @param handler handles requests that come from the other side
	 * @param noThrowForExisting is an optional flag, which true value, is not
	 * throwing exception for an existing handler, turning it into noop, when
	 * handler for a given request has already been set. Default value is false,
	 * triggering throw. 
	 */
	addHandler(reqName: string, handler: RequestHandler<any, any>,
			noThrowForExisting = false): void {
		if (typeof handler !== 'function') { throw new Error(
			`Given handler for request ${reqName} is not a function`); }
		if (this.channel) {
			reqName = `${this.channel}/${reqName}`;
		}
		let existingHandler = this.requestHandlers.get(reqName);
		if (existingHandler) { throw new Error(
			`Handler is already set for request ${reqName}`); }
		this.requestHandlers.set(reqName, handler);
	}
	
	/**
	 * This function forms and sends a reply to a particular request.
	 * @param env is an original request envelope
	 * @param rep is an actual reply body
	 * @param isInProgress is an optional parameter, which, when true, marks this
	 * reply as not final for a given request. Default value is false, marking this
	 * reply as final for a given request.
	 */
	private replyToRequest<T>(env: RequestEnvelope<any>, rep: T,
			isInProgress = false): void {
		let reply: ReplyEnvelope<T> = {
			type: 'reply',
			reqName: env.name,
			reqCount: env.count,
			rep: rep,
		};
		if (isInProgress) {
			reply.isInProgress = true;
		}
		if (this.comm) {
			this.comm.postMessage(reply);
		} else {
			console.error(`Fail to send reply to request ${env.name} #${env.count}, due to ipc point being already disconnected.`);
		}
	}
	
	/**
	 * This method sends a notification of a progress on a given request.
	 * @param env is a request to which notification should be maid
	 * @param rep is a notification object
	 */
	notifyOfProgressOnRequest<T>(env: RequestEnvelope<any>, rep: T): void {
		this.replyToRequest(env, rep, true);
	}

	sendOutboundEvent<T>(eventChannel: string, eventPayload: T): void {
		let eventEnv: EventEnvelope<T> = {
			type: 'event',
			eventChannel,
			eventPayload
		};
		this.comm.postMessage(eventEnv);
	}

	private handleInboundEvent(eventEnv: EventEnvelope<any>): void {
		let listeners = this.inboundEventChannels.get(eventEnv.eventChannel);
		if (!listeners) { return; }
		for (let listener of listeners.values()) {
			try {
				listener(eventEnv);
			} catch (err) {
				console.error(err);
			}
		}
	}

	addInboundEventListener<T>(eventChannel: string,
			listener: EventListener<T>): number {
		let listeners = this.inboundEventChannels.get(eventChannel);
		if (!listeners) {
			listeners = new Map();
			this.inboundEventChannels.set(eventChannel, listeners);
		}
		let isUnique = (listenerId: number): boolean => {
			for (let listeners of this.inboundEventChannels.values()) {
				if (listeners.has(listenerId)) { return false; }
			}
			return true;
		};
		let listenerId: number;
		do {
			listenerId = uint48();
		} while (!isUnique(listenerId));
		listeners.set(listenerId, listener);
		return listenerId;
	}

	removeInboundEventListener(listenerId: number): void {
		for (let listeners of this.inboundEventChannels.values()) {
			if (listeners.delete(listenerId)) { return; }
		}
	}
	
}
Object.freeze(Duplex.prototype);
Object.freeze(Duplex);

Object.freeze(exports);