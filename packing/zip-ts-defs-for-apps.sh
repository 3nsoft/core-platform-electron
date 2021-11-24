#!/bin/bash

defs_folder="$1"
result_file="$2"
temp_dir="defs-temp-dir"
temp_file="defs-temp.zip"

if [ ! -d "$defs_folder" ]
then
	echo "Folder with definitions $defs_folder is not found"
	exit 1
fi

if [ -z "$result_file" ]
then
	echo "Missing second argument with path for zipped folder with definitions"
	exit 1
fi

if [ -d "$temp_dir" ] || [ -e "$result_file" ]
then
	echo "Temporary folder $temp_dir or resulting file $result_file already exist"
	exit 1
fi

lib_defs_rel_path="../../node_modules/core-3nweb-client-lib/build/api-defs"

patch_w3n() {
	local w3n_file="$1"
	node -e "
		const patched = fs.readFileSync('$w3n_file', { encoding: 'utf8' })
		.replace('$lib_defs_rel_path/web3n.d.ts', '../core-defs/web3n.d.ts');
		fs.writeFileSync('$w3n_file', patched, { encoding: 'utf8' });
	" || exit $?
}

mkdir -p $temp_dir/core-defs $temp_dir/platform-defs

cp $defs_folder/*.d.ts $temp_dir/platform-defs/ || exit $?
cp $defs_folder/$lib_defs_rel_path/*.d.ts $temp_dir/core-defs/ || exit $?

patch_w3n $temp_dir/platform-defs/w3n.d.ts || exit $?

cd $temp_dir
zip -rq $temp_file * || exit $?
cd ..
mv $temp_dir/$temp_file $result_file
rm -rf $temp_dir
