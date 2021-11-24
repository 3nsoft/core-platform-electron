/*
 Copyright (C) 2020 - 2021 3NSoft Inc.
 
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


describe('MailerId', () => {

	it('gets current user id', async () => {
		const userId = await w3n.mailerid!.getUserId();
		expect(typeof userId).toBe('string');
	});

	// XXX app can't to outside world, cap is not ready, hence can't do it below
	// it('performs MailerId login', async () => {
	// 	const sessionId = await w3n.mailerid!.login(serviceUrl);
	// 	expect(await isSessionValid(sessionId)).toBe(true);
	// });

});

export const mailerIdTests = true;	// to mark this as module in absence of import(s)