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
import { Duplex, CommunicationPoint } from '../../lib-common/ipc/generic-ipc';

export { Duplex, RequestEnvelope } from '../../lib-common/ipc/generic-ipc';

const HEAD_STATE = 'head';
const BODY_STATE = 'body';

class Parser {

	private state = HEAD_STATE;
	private buf = '';
	private expectedBodyLen = 0;
	
	private isWriting = false;
	private writeQueue: any[] = [];

	constructor(
			private sock: Socket,
			private envListener: (r: any) => void) {
		this.sock.setEncoding('utf8');
		this.sock.unref();
		this.sock.on('data', (str: string) => { this.onData(str); });
		this.sock.on('error', (e: any) => {
			console.log(`Error in IPC client: ${JSON.stringify(e, null, '  ')}`); });
		this.sock.on('close', () => { this.cleanup(); });
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
						this.sock.destroy(new Error(
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
							this.envListener(JSON.parse(this.buf));
						} catch (err) {
							this.sock.destroy(err);
							return;
						}
						this.buf = '';
						this.state = HEAD_STATE;
						pointer +=  1;
					} else {
						this.sock.destroy('Missing newline after body.');
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

	private cleanup(): void {
		this.sock = (undefined as any);
		this.writeQueue = (undefined as any);
		this.buf = (undefined as any);
	}

	close(): void {
		if (this.sock) {
			this.sock.end();
		}
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

export function commToServer(port: number):
		Duplex {
	let parser: Parser|undefined;
	let commPoint: CommunicationPoint = {
		addListener(listener: (r: any) => void): () => void {
			if (parser) { throw new Error(
				'Envelope listener has already been added.'); }
			parser = new Parser(createConnection(port, 'localhost'), listener);
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
	return new Duplex(undefined, commPoint);
}

export function commToClient(port: number): Duplex {
	let parser: Parser|undefined;
	let server: Server;
	function cleanup() {
		if (!parser) { return; }
		parser.close();
		parser = undefined;
		server.close();
	}
	let commPoint: CommunicationPoint = {
		addListener(listener: (r: any) => void): () => void {
			if (parser) { throw new Error(
				'Envelope listener has already been added.'); }
			server = createServer((sock: Socket) => {
				if (parser) {
					sock.end();
					return;
				}
				parser = new Parser(sock, listener);
			})
			.on('error', (err) => {
				console.error(`Error in IPC server: ${JSON.stringify(err)}`) 
				cleanup();
			})
			.listen({ host: 'localhost', port });
			server.unref();
			return () => { cleanup(); };
		},
		postMessage(env: any): void {
			parser!.write(env);
		}
	};
	return new Duplex(undefined, commPoint);
}

Object.freeze(exports);