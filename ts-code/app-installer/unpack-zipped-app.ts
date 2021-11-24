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

import { utf8 } from '../lib-common/buffer-utils';
import { makeRuntimeException } from '../lib-common/exceptions/runtime';
import { AppManifest } from '../app-init/app-settings';
import { Worker } from 'worker_threads';
import { assert } from '../lib-common/assert';
import { defer, Deferred } from '../lib-common/processes';
import { errWithCause } from '../lib-common/exceptions/error';
import { ListRequest, ReadRequest, ReplyMsg, ZipEntryInfo } from './unzip-worker';
import { join } from 'path';

type WritableFS = web3n.files.WritableFS;
type BundleUnpackProgress = web3n.ui.BundleUnpackProgress;

export interface AppZipException extends web3n.RuntimeException {
	type: 'app-zip',
	zipFile: string;
}

function makeAppZipExc(
	zipFile: string, msg?: string, cause?: any
): AppZipException {
	return makeRuntimeException<AppZipException>(
		'app-zip', { zipFile, cause, message: msg }, {});
}

export const APP_ROOT_FOLDER = 'app';
export const MANIFEST_FILE = 'manifest.json';

export async function unzipAppVersion(
	zipFile: string, packsFS: WritableFS,
	progress: (p: BundleUnpackProgress) => void
): Promise<{ unpackedFolder: string; version: string; }> {
	const zip = await ZipReaderInWorker.forLocalFile(zipFile);
	try {
		// manifest (no hash check at this moment)
		const mBytes = await zip.readFile(MANIFEST_FILE)
		.catch(err => {
			throw makeAppZipExc(zipFile, `No manifest file in zip archive`, err);
		});
		const manifest = JSON.parse(utf8.open(mBytes)) as AppManifest;
		const { appDomain, version } = domainAndVersionFrom(manifest, zipFile);
		const unpackedFolder = `${appDomain}-${version}-unzip`;

		const unpackFS = await packsFS.writableSubRoot(unpackedFolder);
		try {
			await unpackFS.writeBytes(MANIFEST_FILE, mBytes);

			// app folder (no hash checks at this moment)
			const filesInApp = (await zip.list()).filter(e => (
				!e.isDirectory && e.entryName.startsWith(`${APP_ROOT_FOLDER}/`)));
			if (filesInApp.length === 0) {
				throw makeAppZipExc(zipFile, `No files in app folder in zip archive`);
			}
			const numOfFiles = filesInApp.length + 1;
			let numOfProcessed = 1;
			progress({ numOfFiles, numOfProcessed });
			for (const entry of filesInApp) {
				progress({
					numOfFiles, numOfProcessed,
					fileInProgress: entry.entryName
				});
				const bytes = await zip.readFile(entry.entryName);
				await unpackFS.writeBytes(entry.entryName, bytes);
				numOfProcessed += 1;
				progress({ numOfFiles, numOfProcessed });
			}

			return { unpackedFolder, version };
		} catch (err) {
			await packsFS.deleteFolder(unpackedFolder, true).catch(() => {});
			throw err;
		}
	} finally {
		zip.close();
	}
}

function domainAndVersionFrom(
	manifest: AppManifest, zipFile: string
): { version: string; appDomain: string; } {
	const appDomain = manifest.appDomain;
	if (!appDomain || (typeof appDomain !== 'string')) {
		throw makeAppZipExc(zipFile, `No version in manifest`);
	}
	const version = manifest.version;
	if (!version || (typeof version !== 'string')) {
		throw makeAppZipExc(zipFile, `No version in manifest`);
	}
	return { appDomain, version };
}

// There is a bug with electrons 12, 13, that doesn't let worker_thread read
// file from asar pack.
// Therefore, when this runs from asar pack, we should switch to unpacked
// in path that is given to worker thread.
// Of course, asarUnpack should be used in electron-builder.
function toUnpackedAsar(p: string): string {
	const ind = p.indexOf('app.asar');
	return ((ind >= 0) ?
		`${p.substring(0, ind+8)}.unpacked${p.substring(ind+8)}` : p
	);
}

const workerPath = join(toUnpackedAsar(__dirname), 'unzip-worker.js');


class ZipReaderInWorker {

	private worker: Worker|undefined = undefined;
	private readonly readQueue: [string, Deferred<Uint8Array>][] = [];
	private currentRead: [string, Deferred<Uint8Array>]|undefined = undefined;
	private lstCall: Deferred<ZipEntryInfo[]>|undefined = undefined;

	private constructor(
		private readonly zipFilePath: string
	) {
		Object.seal(this);
	}

	static async forLocalFile(zipFilePath: string): Promise<ZipReaderInWorker> {
		const zip = new ZipReaderInWorker(toUnpackedAsar(zipFilePath));
		await zip.makeWorker();
		return zip;
	}

	private async makeWorker(): Promise<Worker> {
		assert(!this.worker);

		const worker = new Worker(workerPath, {
			workerData: this.zipFilePath
		});
		this.worker = worker;

		this.worker.on('message', (reply: ReplyMsg) => {
			if (reply.op === 'read-file') {
				if (this.currentRead) {
					if (reply.err) {
						this.currentRead[1].reject(makeAppZipExc(
							this.zipFilePath,
							`Error while unzipping ${this.currentRead[0]}`));
					} else {
						this.currentRead[1].resolve(reply.bytes);
					}
					this.currentRead = undefined;
				}
				this.startNextRead();
			} else if (reply.op === 'list') {
				if (this.lstCall) {
					if (reply.err) {
						this.lstCall.reject(makeAppZipExc(
							this.zipFilePath, `Error while listing zip`));
					} else {
						this.lstCall.resolve(reply.lst);
					}
					this.lstCall = undefined;
				}
			} else {
				this.completeDeferred(makeAppZipExc(
					this.zipFilePath, `Zip worker reply is unknown`));
				worker.terminate();
			}
		});
		this.worker.on('error', err => {
			this.completeDeferred(err);
			worker.terminate();
		});
		this.worker.on('exit', err => this.completeDeferred(err));

		const workerReady = new Promise<void>((resolve, reject) => {
			const errOnStart = (err: any) => reject(errWithCause(err,
				`Failed to start zip reader worker`));
			const earlyExit = (exitCode: number) => reject(new Error(
				`Thread with zip worker exited early with code ${exitCode}`));
			worker.on('error', errOnStart);
			worker.on('exit', earlyExit);
			worker.once('online', () => {
				resolve();
				worker.removeListener('error', errOnStart);
				worker.removeListener('exit', earlyExit);
			});
		});

		await workerReady;
		return worker;
	}

	private completeDeferred(err: any): void {
		if (this.lstCall) {
			this.lstCall.reject(err);
			this.lstCall = undefined;
		}
		if (this.currentRead) {
			this.currentRead[1].reject(err);
			this.currentRead = undefined;
		}
		if (this.readQueue.length > 0) {
			for (const [, deferred] of this.readQueue) {
				deferred.reject(err);
			}
			this.readQueue.splice(0, this.readQueue.length);
		}
	}

	close(): void {
		this.completeDeferred(makeAppZipExc(
			this.zipFilePath, `Zip worker was closed`));
		this.worker!.terminate();
	}

	async list(): Promise<ZipEntryInfo[]> {
		if (!this.lstCall) {
			this.lstCall = defer();
			const req: ListRequest = { op: 'list' };
			this.worker!.postMessage(req);
		}
		return this.lstCall.promise;
	}

	readFile(entryName: string): Promise<Uint8Array> {
		const deferred = defer<Uint8Array>();
		this.readQueue.push([entryName, deferred]);
		this.startNextRead();
		return deferred.promise;
	}

	private startNextRead(): void {
		if (this.currentRead) { return; }
		const next = this.readQueue.shift();
		if (!next) { return; }
		this.currentRead = next;
		const req: ReadRequest = {
			op: 'read-file',
			entryName: this.currentRead[0]
		};
		this.worker!.postMessage(req);
	}

}
Object.freeze(ZipReaderInWorker.prototype);
Object.freeze(ZipReaderInWorker);


export async function readManifestFromZip(
	zipFile: string
): Promise<AppManifest|undefined> {
	const zip = await ZipReaderInWorker.forLocalFile(zipFile);
	try {
		// manifest (no hash check at this moment)
		const bytes = await zip.readFile(MANIFEST_FILE);
		return JSON.parse(utf8.open(bytes));
	} catch (err) {
		return;
	} finally {
		zip.close();
	}
}


Object.freeze(exports);