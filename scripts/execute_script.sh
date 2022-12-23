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
    npm run provision:lib:artefacts
    FILE=$NOCOMPILE
else
    FILE=$1
    shift
fi

NETWORK=$1
shift

IS_AWS_VAULT_INSTALLED=$(command -v "aws-vault" || echo 0)
IS_PROFILE_AVAILABLE=$(aws-vault list | grep "argent-$NETWORK" || echo 0)

if [ "$IS_AWS_VAULT_INSTALLED" == "0" ] || [ "$IS_PROFILE_AVAILABLE" == "0" ];
then
    AWS_PROFILE=argent-$NETWORK AWS_SDK_LOAD_CONFIG=true npx truffle exec $FILE --network $NETWORK "$@"
else
    aws-vault exec argent-$NETWORK -- npx truffle exec $FILE --network $NETWORK "$@"
fi