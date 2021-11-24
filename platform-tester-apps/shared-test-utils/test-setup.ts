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


// Note: this script is loaded into global namespace, on a page, and node's repl

interface UserCreds {
	userId: string;
	pass: string;
}


async function getUserNum(): Promise<number> {
	const resp = await fetch(`./user-num.json`);
	return await resp.json() as number;
}


if ((typeof window === 'undefined') && process && process.argv) {

	function checkCredsFile(
		folder: string, srvDomain: string, userNum: number
	): string {
		const fs = require('fs');
		const crypto = require('crypto');
		const path = require('path');
		const credsFile = path.join(folder, `creds-${userNum}.json`);
		try {
			const txt = fs.readFileSync(credsFile);
			const creds = JSON.parse(txt);
			let msg = `Credentials file found for user ${userNum} with\n`;
			msg += `    user id: ${creds.userId}`;
			return msg;
		} catch (err) {
			if ((err as any).code !== 'ENOENT') {
				throw err;
			}
			const creds: UserCreds = {
				userId: `platform tester  ${Date.now()} @${srvDomain}`,
				pass: crypto.randomBytes(18).toString('base64')
			};
			fs.writeFileSync(credsFile, JSON.stringify(creds, null, 2));
			let msg = `Credentials file is not found for user ${userNum}, and new is created for \n`;
			msg += `    user id: ${creds.userId}\n`;
			msg += `    no signup token`;
			return msg;
		}
	}
	
	const folder = process.argv[2];
	const srvDomain = process.argv[3];
	const userNum = parseInt(process.argv[4]);
	if (!Number.isInteger(userNum)) { throw new Error("Third argument should be integer");  }
	const msg = checkCredsFile(folder, srvDomain, userNum);

	console.log(msg);
}
