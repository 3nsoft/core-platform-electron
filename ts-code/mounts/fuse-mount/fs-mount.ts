/*
 Copyright (C) 2018, 2020 - 2021 3NSoft Inc.

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

import { errWithCause } from '../../lib-common/exceptions/error';
import { constants as masks } from 'fs';
import { sleep, NamedProcs, Action } from '../../lib-common/processes';
import { makeFileException, Code as excCode } from '../../lib-common/exceptions/file';
import { MountOptions } from 'fuse-bindings';
import { Descriptors, Roots } from './descriptors';
import { Descriptor } from './descriptor';
import { logError } from '../../confs';
import { makeRuntimeException } from '../../lib-common/exceptions/runtime';

const fuse = (function() {
	try {
		return require('node-fuse-bindings');
	} catch (err) {
		return undefined as any;
	}
})();

function throwIfNoFUSE(): void {
	if (!fuse) {
		throw makeRuntimeException<FSMountException>(
			'fs-mount', {}, { fuseNotAvailable: true });
	}
}

interface FSMountException extends web3n.RuntimeException {
	type: 'fs-mount';
	fuseNotAvailable: true;
}

type FS = web3n.files.FS;
type FileException = web3n.files.FileException;
type CreateCallback = (code: number, fd: number) => void;

const TMP_FOLDER = 'tmp';

const MOUNT_OPTIONS = [ 'default_permissions', 'direct_io' ];

function combineOptions(o1: string[], o2: string[]): string[] {
	const combined = new Set<string>();
	o1.forEach(opt => combined.add(opt));
	o2.forEach(opt => combined.add(opt));
	return Array.from(combined.values());
}


export class FSMount {

	private readonly syncProc = new NamedProcs();
	private readonly ctx = Object.freeze({
		pid: process.pid,
		uid: process.getuid(),
		gid: process.getgid()
	});
	private readonly fds: Descriptors;
	private mountPath: string|undefined = undefined;

	private constructor(
		private readonly roots: Roots
	) {
		this.fds = new Descriptors(this.roots.descriptorFor);
		Object.seal(this);
	}

	static async mountSingleFS(
		mntPoint: string, fs: FS, mntOpts?: string[]
	): Promise<FSMount> {
		throwIfNoFUSE();
		const fsMount = new FSMount(new Roots(fs));
		await fsMount.fuseAt(mntPoint, mntOpts);
		return fsMount;
	}

	static async mountForManyEntries(
		mntPoint: string, mntOpts?: string[]
	): Promise<FSMount> {
		throwIfNoFUSE();
		const fsMount = new FSMount(new Roots(undefined));
		await fsMount.fuseAt(mntPoint, mntOpts);
		return fsMount;
	}

	/**
	 * This creates instance of fs mount, mounting it on a given path.
	 * @param path on which to mount FUSE-d fs.
	 */
	private async fuseAt(path: string, options?: string[]): Promise<void> {
		const ops: MountOptions = {

			force: true,

			options: (options ?
				combineOptions(MOUNT_OPTIONS, options) :
				MOUNT_OPTIONS),
			
			context: this.context,
			getattr: this.getattr,
			readdir: this.readdir,
			open: this.open,
			release: this.release,
			read: this.read,
			create: this.create,
			unlink: this.unlink,
			mkdir: this.mkdir,
			rmdir: this.rmdir,
			truncate: this.truncate,
			ftruncate: this.ftruncate,
			write: this.write,
			flush: this.flush,
			rename: this.rename,

		};
		
		await new Promise<void>((resolve, reject) => fuse.mount(
			path, ops,
			err => {
				if (err) {
					reject(errWithCause(
						err, `Can't mount FUSE filesystem on ${path}`));
				} else {
					resolve();
				}
			}));
		this.mountPath = path;
	}

	async unmount(): Promise<void> {
		if (this.mountPath === undefined) { return; }
		let lastErr: any;
		for (let i=0; i<5; i+=1) {
			try {
				await new Promise<void>((resolve, reject) => fuse.unmount(
					this.mountPath!,
					err => { if (err) { reject(err); } else { resolve(); } }));
				this.mountPath = undefined;
				return;
			} catch (err) {
				await sleep(100);
				lastErr = err;
			}
		}
		throw makeFileException(excCode.busy, this.mountPath!, lastErr);
	}

	get mntPath(): string|undefined {
		return this.mountPath;
	}

	addToMultiEntryMount(name: string, root: FS): void {
		this.roots.addRoot(root, name);
	}

	// exposeFileInTmp(file: File): string {

	// 	throw new Error('Not implemented');
	// }

	// exposeFSInTmp(fs: FS): string {

	// 	throw new Error('Not implemented');
	// }

	private context: NonNullable<MountOptions['context']> = () => this.ctx;

	private async runSynced<T>(
		path: string, cb: Function, op: keyof MountOptions, action: Action<void>
	): Promise<void> {
		try {
			await this.syncProc.startOrChain(path, action);
		} catch (err) {
			await processError(err, op, cb);
		}
	}

	private getNumbered(fd: number): Descriptor {
		const d = this.fds.getNumbered(fd);
		if (!d) { throw fuse.EBADF; }
		return d;
	}

	private getWritableNumbered(fd: number): Descriptor {
		const d = this.getNumbered(fd);
		if (!d.isInWritableFS()) { throw fuse.EROFS; }
		return d;
	}

	private getWritableUnnumbered(path: string): Descriptor {
		const d = this.fds.getOrMakeUnnumberedFor(path);
		if (!d.isInWritableFS()) { throw fuse.EROFS; }
		return d;
	}

	private getattr: NonNullable<MountOptions['getattr']> = (path, cb) => {
		this.runSynced(path, cb, 'getattr', async () => {
			const d = this.fds.getOrMakeUnnumberedFor(path);
			const stats = await d.getattr(this.ctx, this.roots.getDevId);
			cb(0, stats);
		});
	};

	private readdir: NonNullable<MountOptions['readdir']> = (path, cb) => 
		this.runSynced(path, cb, 'readdir', async () => {
			const d = this.fds.getOrMakeUnnumberedFor(path);
			const lst = await d.readdir();
			cb(0, lst);
		});

	private open: NonNullable<MountOptions['open']> = (path, flags, cb) =>
		this.runSynced(path, cb, 'open', async () => {
			const { d, fd } = this.fds.makeNumberedFor(path);
			try {
				const { create, exclusive } = creationParamsFrom(flags);
				if ((flags & masks.O_RDWR) || (flags & masks.O_WRONLY)) {
					if (!d.isInWritableFS()) {
						throw fuse.EROFS;
					}
					if (create && exclusive) {
						await d.createFile(fd);
					}
				} else {
					await d.checkFilePresence(true);
				}
				cb(0, fd);
			} catch (err) {
				this.fds.dropNumbered(fd);
				throw err;
			}
		});

	private release: NonNullable<MountOptions['release']> = (path, fd, cb) =>
		this.runSynced(path, cb, 'release', async () => {
			const d = this.fds.dropNumbered(fd);
			if (d) {
				d.flush(fd);
			}
			cb(0);
		});

	private flush: NonNullable<MountOptions['flush']> = (path, fd, cb) =>
		this.runSynced(path, cb, 'flush', async () => {
			const d = this.fds.getNumbered(fd);
			if (d) {
				await d.flush(fd);
			}
			cb(0);
		});

	private read: NonNullable<MountOptions['read']> = async (
		path, fd, buffer, length, position, cb
	) => {
		try {
			// we synchronize only on part that uses descriptor
			const deferred = await this.syncProc.startOrChain(path, async () => {
				const d = this.getNumbered(fd);
				const deferred = await d.flushAndStartBytesRead(position, length);
				return deferred;
			});
			// everything else is not blocking anyone else
			const bytes = await deferred.bytesPromise;
			if (!bytes) {
				cb(0);
			} else if (bytes.length <= buffer.length) {
				buffer.set(bytes);
				cb(bytes.length);
			} else {
				throw new Error(`Read from bytes shouldn't produce more bytes than asked`);
			}
		} catch (err) {
			await processError(err, 'read', cb);
		}
	};

	private create: NonNullable<MountOptions['create']> = (path, mode, cb) =>
		this.runSynced(path, cb, 'create', async () => {
			const { d, fd } = this.fds.makeNumberedFor(path);
			try {
				if (!d.isInWritableFS()) {
					throw fuse.EROFS;
				}
				await d.createFile();
				(cb as CreateCallback)(0, fd);
			} catch (err) {
				this.fds.dropNumbered(fd);
				throw err;
			}
		});

	private unlink: NonNullable<MountOptions['unlink']> = (path, cb) =>
		this.runSynced(path, cb, 'unlink', async () => {
			const d = this.getWritableUnnumbered(path);
			await d.deleteFile();
			cb(0);
		});

	private rename: NonNullable<MountOptions['rename']> = (srcPath, destPath, cb) =>
		this.runSynced(srcPath, cb, 'rename', async () => {
			const src = this.fds.getOrMakeUnnumberedFor(srcPath);
			const dst = this.getWritableUnnumbered(destPath);
			if (!src.isOnSameFSWith(dst)) {
				cb(fuse.EXDEV);
				return;
			}
			await src.moveTo(dst);
			cb(0);
		});

	private mkdir: NonNullable<MountOptions['mkdir']> = (path, mode, cb) =>
		this.runSynced(path, cb, 'mkdir', async () => {
			const d = this.getWritableUnnumbered(path);
			await d.makeFolder();
			cb(0);
		});

	private rmdir: NonNullable<MountOptions['rmdir']> = (path, cb) =>
		this.runSynced(path, cb, 'rmdir', async () => {
			const d = this.getWritableUnnumbered(path);
			await d.deleteFolder();
			cb(0);
		});

	private truncate: NonNullable<MountOptions['truncate']> = (path, size, cb) =>
		this.runSynced(path, cb, 'truncate', async () => {
			const d = this.getWritableUnnumbered(path);
			await d.fileTruncate(size);
			cb(0);
		});

	private ftruncate: NonNullable<MountOptions['ftruncate']> = (
		path, fd, size, cb
	) => this.runSynced(path, cb, 'ftruncate', async () => {
		const d = this.getWritableNumbered(fd);
		await d.fileTruncate(size);
		cb(0);
	});

	private write: NonNullable<MountOptions['write']> = (
		path, fd, buffer, length, position, cb
	) => this.runSynced(path, cb, 'write', async () => {
		const d = this.getWritableNumbered(fd);
		await d.fileWrite(fd, buffer, length, position);
		cb(buffer.length);
	});

}
Object.freeze(FSMount.prototype);
Object.freeze(FSMount);


async function processError(
	err: any, op: keyof MountOptions, cb: Function
): Promise<void> {
	const errNum = ((typeof err === 'number') ?
		err : await fileErrToNum(err, op));
	cb(errNum);
}

async function fileErrToNum(
	exc: FileException, op: keyof MountOptions
): Promise<number> {
	let errCode: number;
	if (exc.code) {
		errCode = fuse[exc.code];
		if (typeof errCode === 'number') { return errCode; }
	}
	errCode = fuse.EIO;
	await logError(exc, `Error occured when serving fuse operation < ${op} >, signalling error code ${errCode}`);
	return errCode;
}

function creationParamsFrom(
	flags: number
): { create?: true; exclusive?: true; } {
	if (flags & masks.O_CREAT) {
		if (flags & masks.O_EXCL) {
			return { create: true, exclusive: true };
		} else {
			return { create: true };
		}
	} else {
		return {};
	}
}


Object.freeze(exports);