#!/bin/bash

protos_dir="protos"

mod_file="build/all/ipc-via-protobuf/proto-defs.js"

PROTOS_OBJ="protos"

echo "exports.$PROTOS_OBJ = {};" > $mod_file || exit $?

add_file_to_module () {
	local file_name=$1
	echo "exports.$PROTOS_OBJ['$file_name'] = \`" >> $mod_file
	cat $protos_dir/$file_name >> $mod_file
	echo "\`;" >> $mod_file
}

for file in $(ls $protos_dir)
do
	add_file_to_module $file
done

echo "Object.freeze(exports.$PROTOS_OBJ);" >> $mod_file
echo "Object.freeze(exports);" >> $mod_file
