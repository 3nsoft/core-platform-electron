/*
 Copyright (C) 2018 3NSoft Inc.
 
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

import { SpecDescribe, SpecIt } from '../../libs-for-tests/spec-module';

type FileException = web3n.files.FileException;
declare var testFS: web3n.files.WritableFS;
let cExpect = expect;
let cFail = fail;
function collectAllExpectations(): void {};

export let specs: SpecDescribe = {
	description: '.select',
	its: []
};

let it: SpecIt = { expectation: 'fails early for non-existent path' };
it.func = async function(done: Function) {
	try {
		let path = 'unknown-folder';
		cExpect(await testFS.checkFolderPresence(path)).toBe(false);
		await testFS.select(path, { name: '*.png', action: 'include' })
		.then(() => {
			cFail('select must fail, when folder does not exist');
		}, (err: FileException) => {
			cExpect(err.notFound).toBe(true);
			if (!err.notFound) { throw err; }
		});
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
it.numOfExpects = 2;
specs.its.push(it);

it = { expectation: '' };
it.func = async function(done: Function) {
	try {
		const path = 'testing select';
		await testFS.makeFolder(path);
		// setup files
		const filePaths: string[] = [
			'some.zip', 'some/some/sOME.zip', '1/Some-folder/3.zip',
			'else.txt', 'else/else/some.txt', 'else.zip/some.txt'
		];
		for (const fPath of filePaths) {
			await testFS.writeTxtFile(`${path}/${fPath}`, '');
		}

		// select *.zip files
		let criteria: web3n.files.SelectCriteria = {
			name: '*.zip',
			type: 'file',
			action: 'include',
		};
		let { items, completion } = await testFS.select(path, criteria);

		// wait till collection process is done
		await completion;

		let found = await items.getAll();
		cExpect(found.length).toBe(3);
		for (const [ name, item ] of found) {
			cExpect(name.endsWith('.zip')).toBe(true);
			cExpect(item.isFile).toBe(true);
			cExpect(item.location!.path).toBe(name, `name key for item in collection is the same as path, to ensure uniqueness`);
			cExpect(filePaths.includes(name.substring(1))).toBeTruthy();
			cExpect(item.location!.storageType).toBeFalsy();
			cExpect(item.location!.storageUse).toBeFalsy();
			cExpect(item.location!.fs.writable).toBe(false);
		}

		// select *.zip folder
		criteria.type = 'folder';
		({ items, completion } = await testFS.select(path, criteria));
		await completion;
		found = await items.getAll();
		cExpect(found.length).toBe(1);
		cExpect(found[0][0].endsWith('.zip')).toBe(true);
		cExpect(found[0][1].isFolder).toBe(true);

		// select folders else
		criteria = {
			name: {
				p: 'else',
				type: 'exact'
			},
			type: 'folder',
			action: 'include',
		};
		({ items, completion } = await testFS.select(path, criteria));
		await completion;
		found = await items.getAll();
		cExpect(found.length).toBe(2);
		cExpect(found[0][0].endsWith('/else')).toBe(true);
		cExpect(found[0][1].isFolder).toBe(true);

		// select all with o and e in the name
		criteria = {
			name: '*o*e*',
			action: 'include',
		};
		({ items, completion } = await testFS.select(path, criteria));
		await completion;
		found = await items.getAll();
		cExpect(found.length).toBe(7);

		// select all folders
		criteria = {
			name: '*',
			type: 'folder',
			action: 'include',
		};
		({ items, completion } = await testFS.select(path, criteria));
		await completion;
		found = await items.getAll();
		cExpect(found.length).toBe(7);
		
	} catch (err) {
		cFail(err);
	}
	done(collectAllExpectations());
};
// it.numOfExpects = 2;
specs.its.push(it);


Object.freeze(exports);