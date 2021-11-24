#!/bin/bash

echo "Reuse proto files from core lib"
cp -f node_modules/core-3nweb-client-lib/build/ipc-via-protobuf/protos/* protos/

echo "Remove @types/fs-extra"
rm -rf node_modules/@types/fs-extra

echo "Copy fuse-bindings definitions, when module is present"
if [ -d node_modules/node-fuse-bindings ]
then
	cp -f node_modules/node-fuse-bindings/index.d.ts ts-code/mounts/fuse-mount/fuse-bindings.d.ts
fi

echo "Patch type file inside electron-updater"
node -e "
	const httpExecDefFile = 'node_modules/electron-updater/node_modules/builder-util-runtime/out/httpExecutor.d.ts';
	let def = fs.readFileSync(httpExecDefFile, { encoding: 'utf8' });
	const lineToRm = 'import { BinaryToTextEncoding } from \"crypto\";';
	const pos = def.indexOf(lineToRm);
	if (pos >= 0) {
		def = def.substring(0, pos) +
			def.substring(pos+lineToRm.length) +
			\" type BinaryToTextEncoding = 'base64' | 'hex';\";
		fs.writeFileSync(httpExecDefFile, def, { encoding: 'utf8' });
	}
"