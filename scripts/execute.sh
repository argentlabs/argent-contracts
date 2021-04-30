#!/bin/bash
#
# Usage: ./execute.sh [file] [network] [...params]
#
# Examples: ./execute.sh deregister.js staging --module "0xabc" 

set -e # stop the script if any subprocess fails

FILE=$1
shift

NETWORK=$1
shift

if ! command -v "aws-vault argent-$NETWORK" &> /dev/null
then
    AWS_PROFILE=argent-$NETWORK AWS_SDK_LOAD_CONFIG=true npx truffle exec $FILE --network $NETWORK "$@"
else
    aws-vault exec argent-$NETWORK -- npx truffle exec $FILE --network $NETWORK "$@"
fi
