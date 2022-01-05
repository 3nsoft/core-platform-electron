#!/bin/bash

tester_dir="$(dirname ${BASH_SOURCE[0]})"
data_dir="$tester_dir/../test-data_$(date +%Y-%m-%d_%H-%M)"
app_dir="$tester_dir/startup.3nweb.computer/app"
app2_dir="$tester_dir/tests.3nweb.computer/app"
signup_url="3nweb.net/signup/"
srv_domain="3nweb.com"
platform="$1"

if [ -z "$platform" ]
then
	platform_proj="$tester_dir/.."
	platform="$platform_proj/node_modules/.bin/electron $platform_proj/build/all/main.js"
fi

echo
echo "Starting tests on $platform with"
echo "    data directory: $data_dir"
echo "    signup url: $signup_url"
echo

$platform --data-dir="$data_dir" --allow-multi-instances --devtools --signup-url=$signup_url --test-stand="$tester_dir/test-setup.json"

rm -rf "$data_dir"