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

IS_AWS_VAULT_INSTALLED=$(command -v "aws-vault" || echo 0)
IS_PROFILE_AVAILABLE=$(aws-vault list | grep "argent-$PROFILE" || echo 0)

if [ "$IS_AWS_VAULT_INSTALLED" == "0" ] || [ "$IS_PROFILE_AVAILABLE" == "0" ];
then
    AWS_PROFILE=argent-$NETWORK AWS_SDK_LOAD_CONFIG=true npx truffle exec $FILE --network $NETWORK "$@"
else
    aws-vault exec argent-$NETWORK -- npx truffle exec $FILE --network $NETWORK "$@"
fi
