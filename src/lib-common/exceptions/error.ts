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

export interface ErrorWithCause extends Error {
	cause: any;
}

type EncryptionException = web3n.EncryptionException;

export function errWithCause(cause: any, message: string): ErrorWithCause {
	const err = <ErrorWithCause> new Error(message);
	err.cause = cause;
	if ((cause as EncryptionException).failedCipherVerification) {
		(err as any as EncryptionException).failedCipherVerification = true;
	}
	return err;
}

function recursiveJSONify(err: any): any {
	if (!err) { return ''; }
	if ((err as web3n.RuntimeException).runtimeException) {
		if (err.cause) {
			err.cause = recursiveJSONify(err.cause);
		}
		return err;
	} else if (!err || (typeof err !== 'object')) {
		return err;
	} else {
		const jsonErr: any = {
			error: err.message,
			stack: err.stack
		};
		if ((err as ErrorWithCause).cause) {
			jsonErr.cause = recursiveJSONify((err as ErrorWithCause).cause);
		}
		return jsonErr;
	}
}

export function stringifyErr(err: any): string {
	if (!err) { return ''; }
	
	let errStr: string;
	if ((err as web3n.RuntimeException).runtimeException) {
		if (err.cause) {
			err.cause = recursiveJSONify(err.cause);
		}
		try {
			errStr = `${JSON.stringify(err, null, '  ')}
`;
		} catch (jsonErr) {
			errStr = `<report-error>${jsonErr.message}</report-error>
`;
		}
	} else if (!err || (typeof err !== 'object')) {
		errStr = `${JSON.stringify(err, null, '  ')}
`;
	} else {
		errStr = `Error message: ${err.message}
Error stack: ${err.stack}${
	((err as ErrorWithCause).cause ? `
Caused by:
${JSON.stringify(recursiveJSONify((err as ErrorWithCause).cause), null, '  ')}` :
	'')}
`;
	}
	errStr = errStr
	.split('\\n').join('\n')
	.split('\\\\').join('\\');
	return errStr;
}

Object.freeze(exports);