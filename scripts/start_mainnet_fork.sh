#!/usr/bin/env bash
if [ -z "$CI" ]; then
    source .env

    lsof -i tcp:3601 | grep LISTEN | awk '{print $2}' | xargs kill
fi

# Exit script as soon as a command fails.
set -o errexit

node_modules/.bin/ganache-cli --chainId 1895 --port 3601 --gasPrice 0  --deterministic --fork https://mainnet.infura.io/v3/"$INFURA_KEY" --unlock "0xe982615d461dd5cd06575bbea87624fda4e3de17"