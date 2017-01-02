/*
 Copyright (C) 2015 - 2016 3NSoft Inc.
 
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

import { IGetSigner } from '../../renderer/common';
import { FS } from '../../lib-client/3nstorage/xsp-fs/common';
import * as random from '../../lib-client/random-node';
import { deepEqual } from '../../lib-common/json-equal';
import { getASMailServiceFor } from '../../lib-client/service-locator';
import { MailConfigurator } from '../../lib-client/asmail/service-config';
import * as api from '../../lib-common/service-api/asmail/config';
import { PublishedKeys } from './keyring';
import { FileException } from '../../lib-common/exceptions/file';
import { errWithCause } from '../../lib-common/exceptions/error';
import { ConnectException, ConnectExceptionType }
	from '../../lib-common/exceptions/http';

let ANON_SENDER_INVITES_FNAME = 'anonymous/invites.json';

interface InvitesJSON {
	invites: {
		[token: string]: {
			label: string;
			msgMaxSize: number;
		};
	};
	addresses: {
		[address: string]: string;
	};
}

/**
 * Extending classes must have the following methods setFromJSON(json),
 * toJSON() and init()
 */
abstract class ParamOnFileAndServer<TF, TS> {
	
	constructor(
			private fs: FS,
			private filePath: string,
			private paramPath: string,
			private serviceConf: MailConfigurator) {
		if (!this.fs) { throw new Error("No file system given."); }
	}
	
	async save(): Promise<void> {
		await this.fs.writeJSONFile(this.filePath, this.toFileJSON())
		await this.serviceConf.setParam(this.paramPath, this.toServiceJSON());
	}
	
	async loadFromFileAndSyncServiceSetting(): Promise<void> {
		try {
			let json = await this.fs.readJSONFile<TF>(this.filePath);
			this.setFromJSON(json);
			let infoOnServer = await this.serviceConf.getParam<TS>(this.paramPath)
			if (!deepEqual(infoOnServer, this.toServiceJSON())) {
				await this.serviceConf.setParam(
					this.paramPath, this.toServiceJSON());
			}
		} catch (exc) {
			if ((<FileException> exc).notFound) {
				this.initStruct();
				await this.save();
			} else if ((<ConnectException> exc).type !== ConnectExceptionType) {
				throw exc;
			}
		}
	}
	
	abstract setFromJSON(json: TF): void;
	
	abstract toFileJSON(): TF;
	
	abstract toServiceJSON(): TS;
	
	abstract initStruct(): void;
	
}

const INVITE_TOKEN_LEN = 40;
const DEFAULT_INVITE_LABEL = 'Default';
const DEFAULT_INVITE_MAX_MSG_SIZE = 500*1024*1024;

class Invites extends ParamOnFileAndServer<InvitesJSON, api.InvitesList> {
	
	private invites: {
		[token: string]: {
			label: string;
			msgMaxSize: number;
		};
	} = {};
	private addresses: {
		[address: string]: string;
	} = {};
	
	constructor(fs: FS, filePath: string, serverPath: string,
			serviceConf: MailConfigurator) {
		super(fs, filePath, serverPath, serviceConf);
		Object.seal(this);
	}
	
	initStruct(): void {
		this.addresses = {};
		this.invites = {};
		this.createNewInvite(DEFAULT_INVITE_LABEL, DEFAULT_INVITE_MAX_MSG_SIZE);
	}
	
	createNewInvite(label: string, msgMaxSize: number): string {
		let token: string;
		do {
			token = random.stringOfB64Chars(INVITE_TOKEN_LEN);
		} while (this.invites[token]);
		this.invites[token] = {
			label: label,
			msgMaxSize: msgMaxSize
		};	
		return token;
	}
	
	setFromJSON(json: InvitesJSON): void {
		this.addresses = json.addresses;
		this.invites = json.invites;
	}
	
	toFileJSON(): InvitesJSON {
		return {
			addresses: this.addresses,
			invites: this.invites
		};
	}
	
	toServiceJSON(): api.InvitesList {
		let serverJSON: api.InvitesList = {};
		for (let token in this.invites) {
			serverJSON[token] = this.invites[token].msgMaxSize;
		}
		return serverJSON;
	}
	
	getFor(address: string): string {
		let token = this.addresses[address];
		if (!token) {
			for (let t in this.invites) {
				if (this.invites[t].label === DEFAULT_INVITE_LABEL) {
					token = t;
					break;
				}
			}
			this.addresses[address] = token;
		}
		return token;
	}
	
}

class IntroKeys {
	
	constructor(
			private fs: FS,
			private keyring: PublishedKeys,
			private getSigner: IGetSigner,
			private serviceConf: MailConfigurator) {
		Object.seal(this);
	}
	
	private async getCertsOnServer(): Promise<api.p.initPubKey.Certs> {
		return await this.serviceConf.getParam<api.p.initPubKey.Certs>(
			api.p.initPubKey.URL_END);
	}
	
	private async putCertsOnServer(certs: api.p.initPubKey.Certs):
			Promise<void> {
		return await this.serviceConf.setParam(api.p.initPubKey.URL_END,
			this.keyring.getIntroKeyCerts());
	}
	
	async checkOrSetPublishedKeyCerts(): Promise<void> {
		let certs = this.keyring.getIntroKeyCerts();
		if (certs) {
			try {
				let certsOnServer = await this.getCertsOnServer();
				if (!deepEqual(certs, certsOnServer)) {
					await this.putCertsOnServer(certs);
				}
			} catch (exc) {
				if ((<ConnectException> exc).type !== ConnectExceptionType) {
					throw exc; }
			}
		} else {
			let signer = await this.getSigner();
			this.keyring.updateIntroKey(signer);
			let certs = this.keyring.getIntroKeyCerts();
			if (!certs) { throw new Error(`Expectation fail: intro key certs must be present after an update`); }
			await this.putCertsOnServer(certs);
		}
	}
}

/**
 * Instance of this class updates and checks setting of ASMail server.
 */
export class ConfigOfASMailServer {
	
	private serviceConf: MailConfigurator;
	private anonInvites: Invites = (undefined as any);
	private introKeys: IntroKeys = (undefined as any);
	private fs: FS = (undefined as any);
	
	constructor(address: string,
			private getSigner: IGetSigner) {
		this.serviceConf = new MailConfigurator(address, this.getSigner);
		Object.seal(this);
	}
	
	async init(fs: FS, publishedKeys: PublishedKeys): Promise<void> {
		try {
			this.fs = fs;
			this.anonInvites = new Invites(this.fs, ANON_SENDER_INVITES_FNAME,
				api.p.anonSenderInvites.URL_END, this.serviceConf);
			this.introKeys = new IntroKeys(this.fs, publishedKeys, this.getSigner,
				this.serviceConf);
			this.serviceConf.setConfigUrl(() => {
				return getASMailServiceFor(this.serviceConf.userId);
			});
			await Promise.all([
				this.anonInvites.loadFromFileAndSyncServiceSetting(),
				this.introKeys.checkOrSetPublishedKeyCerts(),
			]);
		} catch (err) {
			throw errWithCause(err, 'Failed to initialize ConfigOfASMailServer');
		}
	}
	
	anonSenderInviteGetter(): (address: string) => string {
		return (address: string) => {
			return this.anonInvites.getFor(address);
		}
	}
	
}
Object.freeze(ConfigOfASMailServer.prototype);
Object.freeze(ConfigOfASMailServer);

Object.freeze(exports);