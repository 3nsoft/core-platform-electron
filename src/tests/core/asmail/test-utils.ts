/*
 Copyright (C) 2017 - 2018 3NSoft Inc.
 
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

export type W3N = {
	mail: web3n.asmail.Service;
	storage: web3n.storage.Service;
	device: {
		openFileDialog: web3n.device.files.OpenFileDialog;
		saveFileDialog: web3n.device.files.SaveFileDialog;
	};
};

declare var w3n: W3N;

type DeliveryProgress = web3n.asmail.DeliveryProgress;
type OutgoingMessage = web3n.asmail.OutgoingMessage;

/**
 * This function to be run in renderer's context via execExpects
 * @param recipient 
 * @param txtBody 
 */
export async function sendTxtMsg(recipient: string, txtBody: string):
		Promise<string> {
	const msg: OutgoingMessage = {
		msgType: 'mail',
		plainTxtBody: txtBody
	};
	const idForSending = 'd5b6';
	await w3n.mail.delivery.addMsg([ recipient ], msg, idForSending);
	expect(await w3n.mail.delivery.currentState(idForSending)).toBeTruthy();
	const lastInfo = await new Promise<DeliveryProgress>((resolve, reject) => {
		let lastInfo: DeliveryProgress;
		w3n.mail.delivery.observeDelivery(idForSending, {
			next: info => (lastInfo = info),
			complete: () => resolve(lastInfo),
			error: reject
		});
	});
	expect(typeof lastInfo).toBe('object');
	expect(lastInfo!.allDone).toBe(true);
	await w3n.mail.delivery.rmMsg(idForSending);
	expect(await w3n.mail.delivery.currentState(idForSending)).toBeFalsy();
	const recInfo = lastInfo!.recipients[recipient];
	expect(typeof recInfo.idOnDelivery).toBe('string');
	expect(recInfo.err).toBeFalsy(`error when sending message to a particular recipient`);
	return recInfo.idOnDelivery!;
}

export const sendTxtMsgNumOfChecks = 6;
