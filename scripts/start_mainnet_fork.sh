#!/usr/bin/env bash
if [ -z "$CI" ]; then
    source .env

    lsof -i tcp:3601 | grep LISTEN | awk '{print $2}' | xargs kill
fi

# Exit script as soon as a command fails.
set -o errexit

node_modules/.bin/ganache-cli \
    --chainId 1895 \
    --port 3601 \
    --gasPrice 0  \
    --gasLimit 20700000 \
    --deterministic \
    --fork https://mainnet.infura.io/v3/"$INFURA_KEY" \
    --unlock "0x39AA39c021dfbaE8faC545936693aC917d5E7563" `# USDC whale` \
    --unlock "0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643" `# DAI whale` \
    --unlock "0x2F0b23f53734252Bda2277357e97e1517d6B042A" `# WETH whale` \
    --unlock "0xdc954086cf07f3889f186118395bad186179ac77" `# Gro Controller` \
    --unlock "0xe6B692dcC972b9a5C3C414ac75dDc420B9eDC92d" `# Paraswap owner` \

