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
    --fork https://eth-mainnet.alchemyapi.io/v2/$ALCHEMY_KEY \
    --unlock "0x2F0b23f53734252Bda2277357e97e1517d6B042A" `# WETH whale` \
    --unlock "0xa2f987a546d4cd1c607ee8141276876c26b72bdf" `# stETH whale (AnchorVault)` \
    --unlock "0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643" `# DAI whale (Compound)` \
    --unlock "0xe982615d461dd5cd06575bbea87624fda4e3de17" `# USDC minter` \
    --unlock "0xc6cde7c39eb2f0f0095f41570af89efc2c1ea828" `# USDT minter` \
    --unlock "0x6c5024cd4f8a59110119c56f8933403a539555eb" `# sUSD whale (Aave)` \
    --unlock "0xdc954086cf07f3889f186118395bad186179ac77" `# Gro Controller` \
    --unlock "0x36fedc70fec3b77caaf50e6c524fd7e5dfbd629a" `# Paraswap owner` \
    --unlock "0xa5c603e1C27a96171487aea0649b01c56248d2e8" `# Argent ENS owner` \
