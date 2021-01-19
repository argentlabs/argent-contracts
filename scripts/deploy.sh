#!/bin/bash
#
# Usage: ./deploy.sh [--no-compile] [network] [aws-profile-suffix] [...steps]
#        ./deploy.sh [--no-compile] [network] [...steps] (if network == aws-profile-suffix)
#
# Examples: ./deploy.sh development 1 2 3 4
#           ./deploy.sh test 1 2 3 4 5 6
#           ./deploy.sh staging 5 6


set -e # stop the script if any subprocess fails

NOCOMPILE=$1
shift

if [ $NOCOMPILE != "--no-compile" ]; then
    rm -rf build
    npm run compile:lib
    npm run compile
    npm run compile:legacy
    npm run provision:lib:artefacts
    NETWORK=$NOCOMPILE
else
    NETWORK=$1
    shift
fi

re='^[0-9]+$'
if [[ $1 =~ $re ]] ; then
    PROFILE=$NETWORK
else
    PROFILE=$1
    shift
fi



for IDX in "$@"
do
    FILE=`ls ./deployment/${IDX}_*.js`
    echo "Deployment file: $FILE"
    if [ ! -z "${CI:-}" ]; then
        echo "Waiting for ganache to launch on port 8545..."
        while ! nc -z localhost 8545; do sleep 1; done
        echo "ganache running on port 8545"
        npx truffle exec $FILE --network $NETWORK
    else
        AWS_PROFILE=argent-$PROFILE AWS_SDK_LOAD_CONFIG=true npx truffle exec $FILE --network $NETWORK
    fi
    if [ $? -ne 0 ]; then
        exit 1 # exit with failure status
    fi
done
