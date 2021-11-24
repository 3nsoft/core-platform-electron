import { thisAppDomain } from "./test-app-constants.js";
import { getTestUsersOrdered, logErr } from "./test-page-utils.js";

export interface TestSignal {
	testSignal: string;
}

type OutgoingMessage = web3n.asmail.OutgoingMessage;

export async function sendMsg(
	userId: string, msg: OutgoingMessage
): Promise<void> {
	const deliveryId = `${Date.now()}`;
	await w3n.mail!.delivery.addMsg([ userId ], msg, deliveryId);
	await new Promise((resolve, reject) =>  w3n.mail!.delivery.observeDelivery(
		deliveryId, {
			next: async progress => {
				if (progress.allDone) {
					const err = progress.recipients[userId].err;
					if (err) {
						reject(err);
					} else {
						try {
							await w3n.mail!.delivery.rmMsg(deliveryId);
						} catch (err) {
							reject(err);
						} finally {
							resolve(undefined);
						}
					}
				}
			},
			error: reject
		}));
}

export async function sendTestSignal<T extends TestSignal>(
	userId: string, testRequest: T
): Promise<void> {
	try {
		await sendMsg(userId, {
			msgType: `app:${thisAppDomain}`,
			jsonBody: testRequest
		});
	} catch (err) {
		await logErr(`Error occured when sending a signal to ${userId}`, err);
	}
}

let signalListeners: Map<string, Set<TestSignalListener<any>>>|undefined = undefined;
const processedSigMsgs = new Set<string>();
function startSigListening(): void {
	w3n.mail!.inbox.subscribe('message', {
		next: async msg => {
			if ((msg.msgType !== `app:${thisAppDomain}`)
			|| !msg.jsonBody
			|| !(msg.jsonBody as TestSignal).testSignal) {
				return;
			}
			if (processedSigMsgs.has(msg.msgId)) {
				logErr(`Signal message ${msg.msgId} has already been received in this subscription to inbox. Why do we see it again?`);
				return;
			}
			processedSigMsgs.add(msg.msgId);
			await w3n.mail!.inbox.removeMsg(msg.msgId).catch(err => {
				logErr(`Error when removing received test signal message ${msg.msgId}`, err);
			});
			const sigType = (msg.jsonBody as TestSignal).testSignal;
			const sigListeners = signalListeners!.get(sigType);
			if (!sigListeners) { return; }
			for (const listener of Array.from(sigListeners)) {
				try {
					listener(msg.jsonBody, msg.sender);
				} catch (err) {
					logErr(`Error when listener process signal ${sigType}`, err);
				}
			}
		}
	});
}

export type TestSignalListener<T> = (reqSig: T, sender: string) => void;

export function listenForTestSignals<T extends TestSignal>(
	sigType: T['testSignal'], listener: TestSignalListener<T>
): () => void {
	if (!signalListeners) {
		signalListeners = new Map();
		startSigListening();
	}
	let sigListeners = signalListeners.get(sigType);
	if (!sigListeners) {
		sigListeners = new Set();
		signalListeners.set(sigType, sigListeners);
	}
	sigListeners.add(listener);
	return () => {
		sigListeners!.delete(listener);
		if (sigListeners!.size === 0) {
			signalListeners!.delete(sigType);
		}
	};
}

const closeAppSignalType = 'close-app';

export async function sendCloseSignalToAllUsers(): Promise<void> {
	const allUsers = await getTestUsersOrdered();
	const thisUser = await w3n.mailerid!.getUserId();
	const closeCalls = allUsers
	.filter(uId => (uId !== thisUser))
	.map(userId => sendTestSignal(userId, {
		testSignal: closeAppSignalType
	}));
	await Promise.all(closeCalls);
}

export function setupAppClosingOnSignal(timeoutSecs: number): void {
	try {
		listenForTestSignals(closeAppSignalType, sig => {
			if (sig.testSignal === closeAppSignalType) {
				w3n.logout!(true);
			}
		});
	} catch (err) {
		logErr(`Fail to listen for test signal`, err);
	}
	setTimeout(() => {
		if ((window as any).closeW3NAfterTests) {
			w3n.logout!(true);
		}
	}, timeoutSecs*1000);
}
