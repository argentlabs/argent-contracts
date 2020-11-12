#!/usr/bin/env bash
source .env

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd $DIR
mkdir "temp"

priceProviderTokens=$(curl 'https://cloud.argent-api.com/v1/tokens/dailyLimit' | jq -r '.tokens[0] .address')
echo $priceProviderTokens

url="https://api.etherscan.io/api?module=contract&action=getsourcecode&address=$priceProviderTokens&apikey=$ETHERSCAN_API_KEY"
resultEtherScan=$(curl $url | jq '.result[0]')

contractName=$(jq '.ContractName'<<<"$resultEtherScan")
compilerVersion=$(jq '.CompilerVersion'<<<"$resultEtherScan")

(jq -r '.SourceCode'<<<"$resultEtherScan") > "./temp/$contractName.sol"

slither-check-erc "./temp/$contractName.sol" "$contractName" --erc 20