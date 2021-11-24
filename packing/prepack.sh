#!/bin/bash

platform=$1
arch=$2
prepacked_dir="$3"
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

bash packing/prep-bundle-for-build.sh || exit $?

build_conf="packing/app.yml"

echo
echo "	===================================="
echo "	|   Packing for $platform on $arch"
echo "	===================================="
echo
node_modules/.bin/electron-builder --publish never --config $build_conf --dir --$arch || exit $?
mv dist/app/$(ls dist/app | grep unpacked) $prepacked_dir
