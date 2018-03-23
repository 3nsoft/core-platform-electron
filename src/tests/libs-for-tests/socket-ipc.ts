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

import { createConnection, createServer, Socket, Server } from 'net';
import { RequestingClient, RequestServer, RawDuplex, makeRequestServer,
	makeRequestingClient, Observer, Envelope, SingleObserverWrap }
	from '../../lib-common/ipc/generic-ipc';

export { RequestingClient, RequestServer, RequestEnvelope }
	from '../../lib-common/ipc/generic-ipc';

const HEAD_STATE = 'head';
const BODY_STATE = 'body';

class Parser {

	private state = HEAD_STATE;
	private buf = '';
	private expectedBodyLen = 0;
	
	private isWriting = false;
	private writeQueue: any[] = [];

	private observer = new SingleObserverWrap<Envelope>();

	constructor(
			private sock: Socket,
			obs: Observer<Envelope>) {
		this.observer.set(obs);
		this.sock.setEncoding('utf8');
		this.sock.unref();
		this.sock.on('data', (str: string) => { this.onData(str); });
		this.sock.on('error', (e: any) => { this.destroySockOnErr(e) });
		this.sock.on('close', () => {
			this.observer.complete();
			this.sock = (undefined as any);
			this.writeQueue = (undefined as any);
			this.buf = (undefined as any);
		});
		Object.seal(this);
	}

	private send(json: any): void {
		if (!this.sock) { return; }
		let body = JSON.stringify(json);
		this.sock.write(`${body.length}\n${body}\n`, 'utf8', () => {
			json = this.writeQueue.shift();
			if (json === undefined) { return; }
			this.send(json);
		});
	}

	private onData(str: string): void {
		if (this.observer.done) { return; }
		let pointer = 0;
		while (pointer < str.length) {
			if (this.state === HEAD_STATE) {
				let end = str.indexOf('\n', pointer);
				if (end < 0) {
					this.buf += str.substring(pointer);
					pointer = str.length;
				} else {
					this.buf += str.substring(pointer, end);
					this.expectedBodyLen = parseInt(this.buf);
					if (isNaN(this.expectedBodyLen)) {
						this.destroySockOnErr(new Error(
							'Header cannot be parsed as an integer'));
						return;
					}
					this.buf = '';
					this.state = BODY_STATE;
					pointer = end + 1;
				}
			} else {
				let delta = this.expectedBodyLen - this.buf.length;
				if (delta === 0) {
					if (str[pointer] === '\n') {
						try {
							this.observer.next(JSON.parse(this.buf));
						} catch (err) {
							this.destroySockOnErr(err);
							return;
						}
						this.buf = '';
						this.state = HEAD_STATE;
						pointer +=  1;
					} else {
						this.destroySockOnErr(new Error(
							'Missing newline after body.'));
						return;
					}
				} else if (delta >= (str.length - pointer)) {
					this.buf += str.substring(pointer);
					pointer = str.length;
				} else {
					this.buf += str.substring(pointer, pointer + delta);
					pointer += delta;
				}
			}
		}
	}

	private destroySockOnErr(err: any): void {
		if (!this.sock) { return; }
		if (!this.sock.destroyed) {
			this.sock.destroy(err);
		}
		this.sock = (undefined as any);
		this.observer.error(err);
	}

	close(): void {
		if (!this.sock || this.sock.destroyed) { return; }
		this.sock.end();
		this.observer.detach();
	}

	write(json: any): void {
		if (!this.sock) { throw new Error('Socket is disconnected.'); }
		if (this.isWriting) {
			this.writeQueue.push(json);
		} else {
			this.send(json);
		}
	}

}
Object.freeze(Parser.prototype);
Object.freeze(Parser);

export function commToServer(port: number): RequestingClient {
	let parser: Parser|undefined;
	let commPoint: RawDuplex<Envelope> = {
		subscribe(obs: Observer<Envelope>): () => void {
			if (parser) { throw new Error(
				'Envelope listener has already been added.'); }
			parser = new Parser(createConnection(port, 'localhost'), obs);
			return () => {
				if (!parser) { return; }
				parser.close();
				parser = undefined;
			};
		},
		postMessage(env: any): void {
			parser!.write(env);
		}
	};
	return makeRequestingClient(undefined, commPoint);
}

export function commToClient(port: number): RequestServer {
	let parser: Parser|undefined;
	let server: Server;
	function detach() {
		if (!parser) { return; }
		parser.close();
		parser = undefined;
		server.close();
	}
	let commPoint: RawDuplex<Envelope> = {
		subscribe(obs: Observer<Envelope>): () => void {
			if (parser) { throw new Error(
				'Envelope listener has already been added.'); }
			server = createServer((sock: Socket) => {
				if (parser) {
					sock.end();
					return;
				}
				parser = new Parser(sock, obs);
			})
			.on('error', (err) => {
				if (obs.error) { obs.error(err); }
				detach();
			})
			.listen({ host: 'localhost', port });
			server.unref();
			return () => { detach(); };
		},
		postMessage(env: any): void {
			parser!.write(env);
		}
	};
	return makeRequestServer(undefined, commPoint);
}

Object.freeze(exports);