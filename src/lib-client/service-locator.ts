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

import { resolveTxt as resolveDnsTxt } from 'dns';
import { doBodylessRequest, doJsonRequest, makeException, Reply }
	from './xhr-utils';
import { SignedLoad, isLikeSignedKeyCert } from '../lib-common/jwkeys';
import { makeRuntimeException, RuntimeException }
	from '../lib-common/exceptions/runtime';
import { NamedProcs } from '../lib-common/processes';
let Uri = require('jsuri');

async function readJSONLocatedAt(url: string): Promise<Reply<any>> {
	let uri = new Uri(url);
	if (uri.protocol() !== 'https') {
		throw new Error("Url protocol must be https.");
	}
	let rep = await doBodylessRequest<any>({
		url,
		method: 'GET',
		responseType: 'json'
	});
	if (rep.status === 200) {
		if (!rep.data) {
			throw makeException(rep, 'Malformed reply');
		}
		return rep;
	} else {
		throw makeException(rep, 'Unexpected status');
	}
}

function transformPathToCompleteUri(url: string, path: string): string {
	let u = new Uri(url);
	u.path(path);
	return u.toString();
}

export interface ASMailRoutes {
	delivery?: string;
	retrieval?: string;
	config?: string;
}

/**
 * @param url
 * @return a promise, resolvable to ASMailRoutes object.
 */
export async function asmailInfoAt(url: string): Promise<ASMailRoutes> {
	let rep = await readJSONLocatedAt(url);
	let json = rep.data;
	let transform = <ASMailRoutes> {};
	if ('string' === typeof json.delivery) {
		transform.delivery = transformPathToCompleteUri(url, json.delivery);
	}
	if ('string' === typeof json.retrieval) {
		transform.retrieval = transformPathToCompleteUri(url, json.retrieval);
	}
	if ('string' === typeof json.config) {
		transform.config = transformPathToCompleteUri(url, json.config);
	}
	Object.freeze(transform);
	return transform;
}

export interface MailerIdServiceInfo {
	provisioning: string;
	currentCert: SignedLoad;
	previousCerts: SignedLoad[];
}

/**
 * @param url
 * @return a promise, resolvable to MailerIdRoutes object.
 */
export async function mailerIdInfoAt(url: string):
		Promise<MailerIdServiceInfo> {
	let rep = await readJSONLocatedAt(url);
	let json = rep.data;
	let transform = <MailerIdServiceInfo> {};
	if ('string' === typeof json.provisioning) {
		transform.provisioning = transformPathToCompleteUri(url, json.provisioning);
	} else {
		throw makeException(rep, 'Malformed reply');
	}
	if (('object' === typeof json["current-cert"]) &&
			isLikeSignedKeyCert(json["current-cert"])) {
		transform.currentCert = json["current-cert"];
		transform.previousCerts = json["previous-certs"];
	} else {
		throw makeException(rep, 'Malformed reply');
	}
	Object.freeze(transform);
	return transform;
}

export interface StorageRoutes {
	owner?: string;
	shared?: string;
	config?: string;
}

/**
 * @param url
 * @return a promise, resolvable to StorageRoutes object.
 */
export async function storageInfoAt(url: string): Promise<StorageRoutes> {
	let rep = await readJSONLocatedAt(url);
	let json = rep.data;
	let transform = <StorageRoutes> {};
	if ('string' === typeof json.owner) {
		transform.owner = transformPathToCompleteUri(url, json.owner);
	}
	if ('string' === typeof json.shared) {
		transform.shared = transformPathToCompleteUri(url, json.shared);
	}
	if ('string' === typeof json.config) {
		transform.config = transformPathToCompleteUri(url, json.config);
	}
	return transform;
}

/**
 * @param address
 * @return domain string, extracted from a given address
 */
function domainOfAddress(address: string): string {
	address = address.trim();
	let indOfAt = address.lastIndexOf('@');
	if (indOfAt < 0) {
		return address;
	} else {
		return address.substring(indOfAt+1);
	}
}

function checkAndPrepareURL(value: string): string {
	// XXX insert some value sanity check
	
	return 'https://'+value;
}

const EXCEPTION_TYPE = 'service-locating';

function domainNotFoundExc(address?: string): Web3N.ASMail.ServLocException {
	let exc = <Web3N.ASMail.ServLocException> makeRuntimeException(
		'domainNotFound', EXCEPTION_TYPE);
	if (address) {
		exc.address = address;
	}
	return exc;
}

function noServiceRecordExc(address?: string): Web3N.ASMail.ServLocException {
	let exc = <Web3N.ASMail.ServLocException> makeRuntimeException(
		'noServiceRecord', EXCEPTION_TYPE);
	if (address) {
		exc.address = address;
	}
	return exc;
}

/**
 * This implementation extracts exactly one string value for a given service.
 * All other values are ignored, without raising error about misconfiguration.
 * In time we may have several records for the same service type, yet, for now
 * only one TXT per service per domain is considered valid.
 * @param txtRecords are TXT records from dns.
 * @param serviceLabel is a label of service, for which we want to get string
 * value from TXT record.
 * @return string value for a given service among given dns TXT records.  
 */
function extractPair(txtRecords: string[][], serviceLabel: string): string {
	for (let txtRecord of txtRecords) {
		let txt = txtRecord.join(' ');
		let eqPos = txt.indexOf('=');
		if (eqPos < 0) { continue; }
		let name = txt.substring(0, eqPos).trim();
		if (name === serviceLabel) {
			let value = txt.substring(eqPos+1).trim();
			return value;
		}
	}
	return;
}

/**
 * This is promisifying of node's dns.resolveTxt().
 * @param domain for which we need to get TXT dns records
 * @return a promise, resolvable to two dimensional array of strings, which
 * node's function returns.
 */
function resolveTxt(domain: string): Promise<string[][]> {
	return new Promise<string[][]>((resolve, reject) => {
		resolveDnsTxt(domain, (err, texts) => {
			if (err) {
				reject(err);
			} else {
				resolve(texts);
			}
		});
	});
}

interface DnsError extends Error {
	code: string;
	hostname: string;
}

const DNS_ERR_CODE = {
	NODATA: 'ENODATA',
	NOTFOUND: 'ENOTFOUND'
};
Object.freeze(DNS_ERR_CODE);

async function getServiceFor(address: string, serviceLabel: string):
		Promise<string> {
	try {
		let domain = domainOfAddress(address);
		let txtRecords = await resolveTxt(domain);
		let recValue = extractPair(txtRecords, serviceLabel);
		if (!recValue) { throw noServiceRecordExc(address); }
		let url = checkAndPrepareURL(recValue);
		return url;
	} catch (err) {
		if ((<DnsError> err).code === DNS_ERR_CODE.NODATA) {
			throw noServiceRecordExc(address);
		} else if ((<DnsError> err).code === DNS_ERR_CODE.NOTFOUND) {
			throw domainNotFoundExc()
		} else {
			throw err;
		}
	}
}

/**
 * @param address
 * @return a promise, resolvable to MailerId service url, that serves
 * domain of a given address.
 */
export async function getMailerIdServiceFor(address: string): Promise<string> {
	return getServiceFor(address, 'mailerid');
}

/**
 * @param address
 * @return a promise, resolvable to ASMail service url, that serves
 * domain of a given address.
 */
export async function getASMailServiceFor(address: string): Promise<string> {
	return getServiceFor(address, 'asmail');
}

/**
 * @param address
 * @return a promise, resolvable to 3NStorage service url, that serves
 * domain of a given address.
 */
export async function getStorageServiceFor(address: string): Promise<string> {
	return getServiceFor(address, '3nstorage');
}

/**
 * @param address
 * @return a promise, resolvable to ASMailRoutes object and mid root domain.
 */
export async function getMailerIdInfoFor(address: string):
		Promise<{ info: MailerIdServiceInfo; domain: string; }> {
	let serviceURL = await getMailerIdServiceFor(address);
	let rootAddr = (new Uri(serviceURL)).host();
	let info = await mailerIdInfoAt(serviceURL);
	return {
		info: info,
		domain: rootAddr
	};
}

Object.freeze(exports);