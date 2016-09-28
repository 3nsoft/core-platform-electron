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

export interface RequestEnvelope<T> {
	name: string;
	count: number;
	req: T;
}

export interface WorkerError {
	name?: string;
	message: string;
	stack?: string;
	cause?: any;
}

function toWorkerError(e: ErrorWithCause): WorkerError {
	let cause: any;
	if (e.cause) {
		if (typeof e.cause === 'object') {
			cause = toWorkerError(e.cause);
		} else {
			cause = e.cause;
		}
	}
	let err: WorkerError = {
		message: e.message,
		name: e.name,
		stack: e.stack,
		cause
	};
	return err;
}

export interface ReplyEnvelope<T> {
	reqName: string;
	reqCount: number;
	isInProgress?: boolean;
	rep: T;
	err?: WorkerError|RuntimeException;
}

export declare type Envelope<T> = ReplyEnvelope<T> | RequestEnvelope<T>;

export interface CommunicationPoint {
	
	/**
	 * This sends a given envelope to the other side of ipc.
	 * @param env
	 */
	postMessage(env: Envelope<any>): void;
	
	/**
	 * This adds listener for receiving envelopes from the other side of ipc.
	 * @param listener
	 * @return a listener detaching function, which should be used when closing
	 * this ipc channel.
	 */
	addListener(listener: (r: Envelope<any>) => void): () => void;
}

export interface RequestHandler<TReq, TRes> {
	(env: RequestEnvelope<TReq>): Promise<TRes>|void;
}

function isReplyMsg(env: Envelope<any>): boolean {
	let rep = <ReplyEnvelope<any>> env;
	return (('object' === typeof rep) &&
			('string' === typeof rep.reqName) &&
			('number' === typeof rep.reqCount));
}

function isRequestMsg(env: Envelope<any>): boolean {
	let req = <RequestEnvelope<any>> env;
	return (('object' === typeof req) &&
			('string' === typeof req.name) &&
			('number' === typeof req.count));
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
	
	constructor(
			private channel: string,
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
			reqName: env.name,
			reqCount: env.count,
			rep: null,
			err: null
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
	
	private handleMsg(r: Envelope<any>): void {
		if (isReplyMsg(r)) {
			this.handleReply(<ReplyEnvelope<any>> r);
		} else if (isRequestMsg(r)) {
			this.handleRequest(<RequestEnvelope<any>> r);
		} else {
			console.error(`Got malformed message: ${JSON.stringify(r)}`);
		}
	}
	
	/**
	 * This rejects all pending request, clearing internal containers.
	 */
	rejectAndClearPendingRequests() {
		for (let reqNum of this.replyDeferreds.keys()) {
			if (isNaN(reqNum)) { continue; }
			this.replyDeferreds.get(reqNum).reject(new Error(
				'All pending requests are flushed.'));
		}
		this.replyDeferreds.clear();
	}
	
	close() {
		this.comm = null;
		this.rejectAndClearPendingRequests();
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
	 */
	addHandler(reqName: string, handler: RequestHandler<any, any>): void {
		if (this.channel) {
			reqName = `${this.channel}/${reqName}`;
		}
		let existingHandler = this.requestHandlers.get(reqName);
		if (existingHandler) { throw new Error(
			'Handler is already set for request '+reqName); }
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
	 * This function sends a notification of a progress on a given request.
	 * @param env is a request to which notification should be maid
	 * @param rep is a notification object
	 */
	notifyOfProgressOnRequest<T>(env: RequestEnvelope<any>, rep: T): void {
		this.replyToRequest(env, rep, true);
	}
	
}
Object.freeze(Duplex.prototype);
Object.freeze(Duplex);

Object.freeze(exports);