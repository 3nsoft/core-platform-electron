#!/bin/bash

# Repos
GIT_GROUP_PATH="https://github.com/3nsoft/"
GIT_EXT=".git"

# Repo folders
CORE="core-platform-electron"
DESK_UI="personal-client-desktop"
STARTUP_UI="personal-client-start-app"
SPEC_SERVER="spec-server"

# This function ensures that a given repo (1st argument) is cloned to current folder
function ensure_repo_cloned {
	REPO=$1
	echo;
	if [ -d ./$REPO ]; then
		echo "Repository $FOLDER is found on disk";
	else
		echo "Cloning repository $REPO ...";
		git clone $GIT_GROUP_PATH$REPO$GIT_EXT
		if [ $? -ne 0 ]; then
			echo "Cannot clone repository $REPO. Check above, if git produced any errors.";
			return 1;
		fi
	fi
	return 0;
}

function update_repo {
	REPO=$1
	echo;
	echo "Updating repository $REPO ...";
	cd $REPO
	git pull
	if [ $? -ne 0 ]; then
		echo "Problems updating git repository $REPO. Check above, if git produced any errors.";
		cd ..
		return 1;
	else
		echo "Done.";
		cd ..
		return 0;
	fi
}

# This function installs/updates npm modules in a package (1st argument)
function npm_update {
	REPO=$1
	echo;
	echo "Updating npm modules in $REPO ...";
	cd $REPO
	npm install
	if [ $? -ne 0 ]; then
		echo "Problems updating npm modules in $REPO. Check above, if npm produced any errors.";
		cd ..
		return 1;
	else
		echo "Done.";
		cd ..
		return 0;
	fi
}

# get out from core's folder
cd ..

for FOLDER in $CORE $STARTUP_UI $DESK_UI $SPEC_SERVER
do
	ensure_repo_cloned $FOLDER
	if [ $? -ne 0 ]; then exit 1; fi
	update_repo $FOLDER
	if [ $? -ne 0 ]; then exit 1; fi
	npm_update $FOLDER
	if [ $? -ne 0 ]; then exit 1; fi

done
echo;


