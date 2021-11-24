#!/bin/bash

tester_dir="$(dirname ${BASH_SOURCE[0]})"

cd $tester_dir

echo "Copying jasmine code in app folders"
for app in apps-menu.3nweb.computer startup.3nweb.computer
do
	rm $app/public/jasmine
	cp -r shared-test-utils/jasmine-3.9.0 $app/public/jasmine
done

echo "Copying shared test utils code"
for app in apps-menu.3nweb.computer startup.3nweb.computer
do
	rm $app/src/test-setup.ts
	cp -r shared-test-utils/test-setup.ts $app/src/
done
