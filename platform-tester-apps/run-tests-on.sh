#!/bin/bash

tester_dir="$(dirname ${BASH_SOURCE[0]})"
data_dir="$tester_dir/../test-data_$(date +%Y-%m-%d_%H-%M)"
app_dir="$tester_dir/startup.3nweb.computer/app"
app2_dir="$tester_dir/apps-menu.3nweb.computer/app"
signup_url="3nweb.net/signup/"
srv_domain="3nweb.com"
platform="$1"

if [ -z "$platform" ]
then
	platform_proj="$tester_dir/.."
	platform="$platform_proj/node_modules/.bin/electron $platform_proj/build/all/main.js"
fi

declare -A userProcs || declare userProcs
userProcs[1]=""
userProcs[2]=""

echo
echo "Starting tests on $platform with"
echo "    data directory: $data_dir"
echo "    signup url: $signup_url"
for u_num in ${!userProcs[@]}
do
	node "$app_dir/test-setup.js" "$app_dir" $srv_domain $u_num || exit $?
done
cp "$app_dir"/creds-* $app2_dir/
echo

user_num_file="$app_dir/user-num.json"

for u_num in ${!userProcs[@]}
do
	echo "$u_num" > "$user_num_file"

	$platform --data-dir="$data_dir" --allow-multi-instances --devtools --signup-url=$signup_url --dev-app="$tester_dir/apps-menu.3nweb.computer" --dev-app="$tester_dir/startup.3nweb.computer" &

	userProcs[$u_num]=$!
	echo "Platform for user $u_num started under pid ${userProcs[$u_num]}"
	echo

	sleep 3
done

rm "$user_num_file"

wait

echo
echo "Application log files:"
for log in $(ls "$data_dir/util/logs")
do
	log_str="$(cat "$data_dir/util/logs/$log")"
	if [ -n "$( echo "$log_str" | grep "\-- Jasmine tests failed ---" )" ]
	then
		test_status="fail"
	elif [ -z "$test_status" ] && [ -n "$( echo "$log_str" | grep "\-- Jasmine tests passed ---" )" ]
	then
		test_status="pass"
	fi
	echo "    <$log start>"
	echo "$log_str"
	echo "    <$log end>"
	echo
done

echo
echo "Removing test data directory: $data_dir"
echo
rm -rf "$data_dir"

if [ "$test_status" == "pass" ]
then
	exit 0
elif [ "$test_status" == "fail" ]
then
	echo "One or several Jasmine tests fail. Check logs above."
	exit 1
else
	echo "Jasmine output wasn't found in logs."
	exit 1
fi
