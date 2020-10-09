#!/bin/bash
#
# Usage: ./execute_script.sh [--no-compile] [file] [network] [...params]
#
# Examples: ./execute_script.sh --no-compile update_module_registry.js staging --remove --module "0xabc" 

set -e # stop the script if any subprocess fails

NOCOMPILE=$1
shift

if [ $NOCOMPILE != "--no-compile" ]; then
    rm -rf build
    npm run compile:lib
    npm run compile
    npm run compile:legacy
    FILE=NO-COMPILE
else
    FILE=$1
    shift
fi

NETWORK=$1
shift

AWS_PROFILE=argent-$NETWORK AWS_SDK_LOAD_CONFIG=true node $FILE --network $NETWORK "$@"