#!/bin/sh

node_modules/.bin/etherlime flatten wallet/BaseWallet.sol 0.5.4
node_modules/.bin/etherlime flatten wallet/WalletFactory.sol 0.5.4
node_modules/.bin/etherlime flatten modules/common/BaseModule.sol 0.5.4
node_modules/.bin/etherlime flatten modules/ApprovedTransfer.sol 0.5.4
node_modules/.bin/etherlime flatten modules/CommunityManager.sol 0.5.4
node_modules/.bin/etherlime flatten modules/CompoundManager.sol 0.5.4
node_modules/.bin/etherlime flatten modules/DAIPointsManager.sol 0.5.4
node_modules/.bin/etherlime flatten modules/GuardianManager.sol 0.5.4
node_modules/.bin/etherlime flatten modules/LockManager.sol 0.5.4
node_modules/.bin/etherlime flatten modules/MakerManager.sol 0.5.4
node_modules/.bin/etherlime flatten modules/MakerV2Manager.sol 0.5.4
node_modules/.bin/etherlime flatten modules/NftTransfer.sol 0.5.4
node_modules/.bin/etherlime flatten modules/RecoveryManager.sol 0.5.4
node_modules/.bin/etherlime flatten modules/TokenExchanger.sol 0.5.4
node_modules/.bin/etherlime flatten modules/TransferManager.sol 0.5.4
node_modules/.bin/etherlime flatten modules/UniswapManager.sol 0.5.4
node_modules/.bin/etherlime flatten modules/WalletOwnershipManager.sol 0.5.4