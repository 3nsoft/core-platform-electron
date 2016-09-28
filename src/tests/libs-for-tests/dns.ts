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

import { bind } from '../../lib-common/binding';

const DNS_ERR_CODE = {
	NODATA: 'ENODATA',
	NOTFOUND: 'ENOTFOUND'
};
Object.freeze(DNS_ERR_CODE);

interface DnsError extends Error {
	code: string;
	hostname: string;
}

function makeDnsError(code: string, hostname: string): DnsError {
	let e = <DnsError> new Error(`Mocked DNS error with code ${code}`);
	e.code = code;
	e.hostname = hostname;
	return e;
}

/**
 * @param address
 * @return domain string, extracted from a given address
 */
function domainOfAddress(address: string): string {
	address = address.trim();
	let indOfAt = address.lastIndexOf('@');
	let domain = ((indOfAt < 0) ? address : address.substring(indOfAt+1));
	return domain;
}

export interface DnsTxtRecords {
	[ domain: string ]: string[][];
}

export class DNSMock {

	resolveTxt: (domain: string,
		callback: (err: Error, txt: string[][]) =>void ) => void;
	
	private domains = new Map<string, string[][]>();
	private mailerIdRec: string;
	
	constructor(midUrlOrBulkRecs: string | DnsTxtRecords) {
		if (typeof midUrlOrBulkRecs === 'string') {
			if (midUrlOrBulkRecs.indexOf('://') >= 0) {
				this.mailerIdRec = midUrlOrBulkRecs.substring(
					midUrlOrBulkRecs.indexOf('://')+3);
			} else {
				this.mailerIdRec = midUrlOrBulkRecs;
			}
		} else {
			let domains = Object.keys(midUrlOrBulkRecs);
			for (let d of domains) {
				this.domains.set(d, midUrlOrBulkRecs[d]);
			}
		}
		this.resolveTxt = bind(this, this.mockResolve);
		Object.freeze(this);
	}
	
	private mockResolve(domain: string,
			callback: (err: Error, txt: string[][]) => void): void {
		let d = domainOfAddress(domain);
		let txt = this.domains.get(d);
		if (txt) {
			callback(null, txt);
		} else {
			callback(makeDnsError(DNS_ERR_CODE.NOTFOUND, d), null);
		}
	}

	// TODO at this moment only mailerid record is added.
	//		May be this method should take a more detailed options object.  
	configureFor(userId: string): void {
		if (!this.mailerIdRec) { throw new Error(
			'DNS mock is not set to configure individial entries'); }
		this.domains.set(domainOfAddress(userId),
			[ [ `mailerid=${this.mailerIdRec}` ] ]);
	}
	
}
Object.freeze(DNSMock.prototype);
Object.freeze(DNSMock);

Object.freeze(exports);