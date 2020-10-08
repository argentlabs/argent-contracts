#!/bin/bash
#
# Usage: ./execute.sh [file] [network] [...params]
#
# Examples: ./execute.sh deregister.js staging --module "0xabc" 

set -e # stop the script if any subprocess fails

# rm -rf build
# npm run compile:lib
# npm run compile
# npm run compile:legacy

FILE=$1
shift

NETWORK=$1
shift

AWS_PROFILE=argent-$NETWORK AWS_SDK_LOAD_CONFIG=true node $FILE --network $NETWORK "$@"