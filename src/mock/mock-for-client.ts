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

import { app } from 'electron';
import { ClientWin } from '../ui/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const MOCK_PRELOAD = resolve(__dirname, './renderer/preload/client.js');
const CONFS = resolve(__dirname, '../apps/client/mock-conf.json');

let clientWins: ClientWin[] = [];
let mockConf= JSON.parse(readFileSync(CONFS, 'utf8'));

app.on('ready', () => {

	for (let ind of mockConf.users) {
		if (typeof ind !== 'number') { continue; }
		clientWins.push(new ClientWin(MOCK_PRELOAD, { user: ind }));
	}

});

app.on('window-all-closed', () => {
	app.quit();
});
