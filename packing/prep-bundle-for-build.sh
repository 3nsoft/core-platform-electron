#!/bin/bash

copy_code() {
	src_dir="$1"
	shift 1
	dst_dir="$1"
	shift 1
	except="$@"
	mkdir -p "$dst_dir" || return $?
	echo "Copying code to $dst_dir"
	cp -r "$src_dir/"* "$dst_dir/" || return $?
	if [ -n "$except" ]
	then
		echo "except $except"
		for d in $except
		do
			rm -rf "$dst_dir/$d"
		done
	fi
	# cp "$PROTO_DEFS_JS" "$dst_dir/$DST_FOR_PROTO_DEFS/"
	return 0
}

prep_package_json() {
	src_package="$1"
	dst_dir="$2"
	main="$3"
	node -e "
		const packFieldsToCopy = [
			'name', 'version', 'description', 'author', 'license', 'dependencies'
		];
		
		const originalPack = JSON.parse(fs.readFileSync(
			'$src_package', { encoding: 'utf8' }));
		const newPack = {};
		for (const f of packFieldsToCopy) {
			newPack[f] = originalPack[f];
		}
		newPack.main = '$main';
		fs.writeFileSync(
			'$dst_dir/package.json',
			JSON.stringify(newPack, null, '  '),
			{ encoding: 'utf8', flag: 'wx' }
		);
	" || exit $?
	echo "Placed package.json into $dst_dir/"
}

prep_package_lock_json() {
	src_pack_lock="$1"
	dst_dir="$2"
	node -e "
		const originalLock = JSON.parse(fs.readFileSync(
			'$src_pack_lock', { encoding: 'utf8' }));
		const newLock = {};
		for (const field of Object.keys(originalLock)) {
			newLock[field] = (field === 'dependencies') ? {} : originalLock[field];
		}
		if (originalLock.dependencies) {
			for (const packName of Object.keys(originalLock.dependencies)) {
				const pack = originalLock.dependencies[packName];
				if (pack.dev || packName.startsWith('@types/')) { continue; }
				newLock.dependencies[packName] = pack;
			}
		}
		fs.writeFileSync(
			'$dst_dir/package-lock.json',
			JSON.stringify(newLock, null, '  '),
			{ encoding: 'utf8', flag: 'wx' }
		);
	" || exit $?
	echo "Placed package-lock.json into $dst_dir"
}

src_dir="build/all"
pack_file="package.json"
lock_file="package-lock.json"

echo "	************************"
echo "	*  Copy platform code  *"
echo "	************************"
app_dir="build/app"
if [ -d $app_dir ]
then
	rm -rf $app_dir
fi
copy_code $src_dir $app_dir tests || exit $?
prep_package_json $pack_file $app_dir "main.js"
prep_package_lock_json $lock_file $app_dir

echo "	*********************"
echo "	*  Copy icon files  *"
echo "	*********************"
echo "Copying icons folder into $app_dir/"
cp -r packing/icons $app_dir/ 
