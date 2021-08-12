#!/usr/bin/env bash

if ! npm link ../argent-trustlists ; then
	 printf "\n\n    /!\\ First clone the argent-trustlists repo (read the README) /!\\ \n\n\n"
	 exit 1
fi
