#!/bin/bash

platform=$1
arch=$2
prepacked_dir="$3"
shift 3
if [ -z "$platform" ]
then
	echo "First argument, platform name, is not given"
	exit 1
fi
if [ -z "$arch" ]
then
	echo "Second argument, architecture, is not given"
	exit 1
fi
if [ -z "$prepacked_dir" ]
then
	echo "Third argument, name for directory with prepacked things, is not given"
	exit 1
fi

build_conf="packing/app.yml"
if [ "$platform" == "mac" ]
then
	pack_info_file="$prepacked_dir/mac/3NWeb.app/Contents/Resources/app.asar.unpacked/packing-info.json"
else
	pack_info_file="$prepacked_dir/resources/app.asar.unpacked/packing-info.json"
fi

write_pack_info() {
	local variant=$1
	echo "{
	\"platform\": \"$platform\",
	\"variant\": \"$1\",
	\"arch\": \"$arch\"
}" > $pack_info_file
}

build_from_prepackaged() {
	local target=$1
	echo
	echo "	================================="
	echo "	|   Building $target for $arch"
	echo "	================================="
	echo
	write_pack_info $target || return $?
	node_modules/.bin/electron-builder --publish never --config $build_conf --prepackaged $prepacked_dir --$platform $target --$arch || return $?
}

echo
echo "$platform builds, based on prepackaged stuff from ${prepacked_dir}:"
for target in $@
do
	build_from_prepackaged $target || exit $?
done
