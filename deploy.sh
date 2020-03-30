#!/bin/bash
#
# Usage: ./deploy.sh [network] [aws-profile-suffix] [...steps]
#        ./deploy.sh [network] [...steps] (if network == aws-profile-suffix)
#
# Examples: ./deploy.sh dev 1 2 3 4
#           ./deploy.sh ganache 1 2 3 4 5 6
#           ./deploy.sh ropsten dev 5 6


set -e # stop the script if any subprocess fails

NETWORK=$1
shift

re='^[0-9]+$'
if [[ $1 =~ $re ]] ; then
    PROFILE=$NETWORK
else
    PROFILE=$1
    shift
fi

npx etherlime compile --runs 999

for IDX in "$@"
do
    FILE=`ls ./deployment/${IDX}_*.js`
    AWS_PROFILE=argent-$PROFILE AWS_SDK_LOAD_CONFIG=true npx etherlime deploy --file $FILE --network $NETWORK --compile false
    if [ $? -ne 0 ]; then
        exit 1 # exit with failure status
    fi
done
