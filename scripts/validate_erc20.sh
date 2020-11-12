#!/usr/bin/env bash
source .env

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd $DIR
mkdir "temp"

for tokenAddress in $(curl -s 'https://cloud.argent-api.com/v1/tokens/dailyLimit' | jq -r '.tokens[] | select(.address != "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") | .address')
do
    echo "${tokenAddress}"

    url="https://api.etherscan.io/api?module=contract&action=getsourcecode&address=$tokenAddress&apikey=$ETHERSCAN_API_KEY"
    resultEtherScan=$(curl -s $url | jq '.result[0]')

    contractName=$(jq -r '.ContractName'<<<"$resultEtherScan")
    compilerVersionString=$(jq -r '.CompilerVersion | .[1:]'<<<"$resultEtherScan")
    compilerVersion=$(cut -d"+" -f1<<<"$compilerVersionString")
    echo $compilerVersion

    (jq -r '.SourceCode'<<<"$resultEtherScan") > "./temp/$contractName.sol"

    SOLC_VERSION=$compilerVersion slither-check-erc "./temp/$contractName.sol" "$contractName" --erc ERC20

done
rm -r "temp"