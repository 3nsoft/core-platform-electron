#!/bin/bash

tester_dir="$(dirname ${BASH_SOURCE[0]})"

cd $tester_dir

echo "Copying jasmine code in app folders"
for app in tests.3nweb.computer startup.3nweb.computer
do
	rm $app/public/jasmine
	cp -r shared-test-utils/jasmine-3.9.0 $app/public/jasmine
done
