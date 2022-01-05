/*
 Copyright (C) 2021 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { ExposedFn, Caller, ExposedObj, ExposedServices, exposeLogger, makeLogCaller, EnvelopeBody } from 'core-3nweb-client-lib';
import { Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { ProtoType, strValType, toVal, unpackInt, packInt } from '../ipc-via-protobuf/protobuf-msg';

type StartupTestStand = web3n.testing.StartupTestStand;
type TestStand = web3n.testing.TestStand;

export function exposeStartupTestStandCAP(
	cap: StartupTestStand
): ExposedObj<StartupTestStand> {
	return {
		log: exposeLogger(cap.log),
		record: record.wrapService(cap.record),
		exitAll: exitAll.wrapService(cap.exitAll),
		staticTestInfo: staticTestInfo.wrapService(cap.staticTestInfo),
	};
}

export function exposeTestStandCAP(cap: TestStand): ExposedObj<TestStand> {
	return {
		log: exposeLogger(cap.log),
		record: record.wrapService(cap.record),
		exitAll: exitAll.wrapService(cap.exitAll),
		staticTestInfo: staticTestInfo.wrapService(cap.staticTestInfo),
		idOfTestUser: idOfTestUser.wrapService(cap.idOfTestUser),
		sendMsgToOtherLocalTestUser: sendMsgToOtherLocalTestUser.wrapService(
			cap.sendMsgToOtherLocalTestUser),
		observeMsgsFromOtherLocalTestUser:
			observeMsgsFromOtherLocalTestUser.wrapService(
				cap.observeMsgsFromOtherLocalTestUser
			),
	};
}

export function makeStartupTestStandCaller(
	caller: Caller, objPath: string[]
): StartupTestStand {
	return {
		log: makeLogCaller(caller, objPath.concat('log')),
		record: record.makeCaller(caller, objPath),
		exitAll: exitAll.makeCaller(caller, objPath),
		staticTestInfo: staticTestInfo.makeCaller(
			caller, objPath) as StartupTestStand['staticTestInfo'],
	};
}

export function makeTestStandCaller(
	caller: Caller, objPath: string[]
): TestStand {
	return {
		log: makeLogCaller(caller, objPath.concat('log')),
		record: record.makeCaller(caller, objPath),
		exitAll: exitAll.makeCaller(caller, objPath),
		staticTestInfo: staticTestInfo.makeCaller(caller, objPath),
		idOfTestUser: idOfTestUser.makeCaller(caller, objPath),
		sendMsgToOtherLocalTestUser: sendMsgToOtherLocalTestUser.makeCaller(
			caller, objPath),
		observeMsgsFromOtherLocalTestUser:
			observeMsgsFromOtherLocalTestUser.makeCaller(caller, objPath),
	};
}


function testStandType<T extends object>(type: string): ProtoType<T> {
	return ProtoType.makeFrom<T>('test_stand.proto', `test_stand.${type}`);
}


namespace exitAll {

	export function wrapService(fn: StartupTestStand['exitAll']): ExposedFn {
		return () => {
			const promise = fn();
			return { promise };
		}
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): StartupTestStand['exitAll'] {
		const path = objPath.concat('exitAll');
		return () => caller.startPromiseCall(path, undefined)
		.then(noop);
	}

}
Object.freeze(exitAll);


function noop() {}


namespace record {

	interface Request {
		type: web3n.testing.TestRecordType,
		msg?: string;
	}

	const requestType = testStandType<Request>('RecordRequestBody');

	export function wrapService(fn: StartupTestStand['record']): ExposedFn {
		return (reqBody: Buffer) => {
			const { type, msg } = requestType.unpack(reqBody);
			const promise = fn(type, msg);
			return { promise };
		};
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): StartupTestStand['record'] {
		const path = objPath.concat('record');
		return (type, msg) => {
			const req: Request = { type, msg };
			return caller.startPromiseCall(path, requestType.pack(req))
			.then(noop);
		};
	}

}
Object.freeze(record);


namespace staticTestInfo {

	export function wrapService(
		fn: StartupTestStand['staticTestInfo'] | TestStand['staticTestInfo']
	): ExposedFn {
		return () => {
			const promise = fn()
			.then(info => strValType.pack(toVal(JSON.stringify(info))));
			return { promise };
		}
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): TestStand['staticTestInfo'] {
		const path = objPath.concat('staticTestInfo');
		return () => caller.startPromiseCall(path, undefined)
		.then(buf => JSON.parse(strValType.unpack(buf).value));
	}

}
Object.freeze(staticTestInfo);


namespace idOfTestUser {

	export function wrapService(fn: TestStand['idOfTestUser']): ExposedFn {
		return buf => {
			const promise = fn(unpackInt(buf))
			.then(userId => strValType.pack(toVal(userId)));
			return { promise };
		}
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): TestStand['idOfTestUser'] {
		const path = objPath.concat('idOfTestUser');
		return userNum => caller.startPromiseCall(path, packInt(userNum))
		.then(buf => strValType.unpack(buf).value);
	}

}
Object.freeze(idOfTestUser);


namespace sendMsgToOtherLocalTestUser {

	interface Request {
		userNum: number;
		appDomain?: string;
		msgJson: string;
	}

	const requestType = testStandType<Request>(
		'SendMsgToOtherLocalTestUserRequestBody');

	export function wrapService(
		fn: TestStand['sendMsgToOtherLocalTestUser']
	): ExposedFn {
		return buf => {
			const { userNum, appDomain, msgJson } = requestType.unpack(buf);
			const promise = fn(userNum, appDomain, JSON.parse(msgJson));
			return { promise };
		}
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): TestStand['sendMsgToOtherLocalTestUser'] {
		const path = objPath.concat('sendMsgToOtherLocalTestUser');
		return (userNum, appDomain, msg) => caller.startPromiseCall(
			path,
			requestType.pack({
				userNum, appDomain, msgJson: JSON.stringify(msg)
			}))
		.then(noop);
	}

}
Object.freeze(sendMsgToOtherLocalTestUser);


namespace observeMsgsFromOtherLocalTestUser {

	interface Request {
		userNum: number;
		appDomain?: string;
	}

	const requestType = testStandType<Request>(
		'ObserveOtherTestUserRequestBody');

	export function wrapService(
		fn: TestStand['observeMsgsFromOtherLocalTestUser']
	): ExposedFn {
		return buf => {
			const { userNum, appDomain } = requestType.unpack(buf);
			const s = new Subject<any>();
			const obs = s.asObservable().pipe(
				map(msg => strValType.pack(toVal(JSON.stringify(msg))))
			);
			const onCancel = fn(userNum, appDomain, s);
			return { obs, onCancel };
		}
	}

	export function makeCaller(
		caller: Caller, objPath: string[]
	): TestStand['observeMsgsFromOtherLocalTestUser'] {
		const path = objPath.concat('observeMsgsFromOtherLocalTestUser');
		return (userNum, appDomain, obs) => {
			const s = new Subject<EnvelopeBody>();
			const unsub = caller.startObservableCall(
				path, requestType.pack({ appDomain, userNum }), s);
			s.subscribe({
				next: buf => {
					if (obs.next) {
						obs.next(JSON.parse(strValType.unpack(buf).value));
					}
				},
				complete: obs.complete,
				error: obs.error
			});
			return unsub;
		};
	}

}
Object.freeze(observeMsgsFromOtherLocalTestUser);


Object.freeze(exports);