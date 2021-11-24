#!/bin/bash

exclude_package() {
	local mod="$1"
	echo "Excluding package $mod"
	node -e "
		const pack = require('./package.json');
		delete pack.dependencies['$mod'];
		fs.writeFileSync('./package.json', JSON.stringify(pack, null, ' '));
		const lock = require('./package-lock.json');
		delete lock.dependencies['$mod'];
		fs.writeFileSync('./package-lock.json', JSON.stringify(lock, null, ' '));
	" || return $?
}

for mod in $@
do
	exclude_package $mod
done
