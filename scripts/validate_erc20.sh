#!/usr/bin/env bash
source .env

for tokenAddress in $(curl -s 'https://cloud.argent-api.com/v1/tokens/dailyLimit' | jq -r '.tokens[] | select(.address != "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") | .address')
do
    echo "${tokenAddress}"

    url="https://api.etherscan.io/api?module=contract&action=getsourcecode&address=$tokenAddress&apikey=$ETHERSCAN_API_KEY"
    resultEtherScan=$(curl -s $url | jq '.result[0]')

    contractName=$(jq -r '.ContractName'<<<"$resultEtherScan")
    compilerVersionString=$(jq -r '.CompilerVersion | .[1:]'<<<"$resultEtherScan")
    compilerVersion=$(cut -d"+" -f1<<<"$compilerVersionString")
    echo $compilerVersion

    slither-check-erc $tokenAddress "$contractName" --erc ERC20 --etherscan-apikey $ETHERSCAN_API_KEY
done