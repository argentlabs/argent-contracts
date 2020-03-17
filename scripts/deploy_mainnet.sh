#!/bin/sh

node_modules/.bin/etherlime compile --runs=200
node_modules/.bin/etherlime deploy --file deployment/1_setup_test_environment.js --network mainnet --compile false
node_modules/.bin/etherlime deploy --file deployment/2_deploy_contracts.js --network mainnet --compile false
node_modules/.bin/etherlime deploy --file deployment/3_setup_contracts.js --network mainnet --compile false
node_modules/.bin/etherlime deploy --file deployment/4_finalise_test_environment.js --network mainnet --compile false
node_modules/.bin/etherlime deploy --file deployment/5_deploy_modules_v1.js --network mainnet --compile false
node_modules/.bin/etherlime deploy --file deployment/6_register_modules_v1.js --network mainnet --compile false
node_modules/.bin/etherlime deploy --file deployment/7_upgrade_v1_1.js --network mainnet --compile false
node_modules/.bin/etherlime deploy --file deployment/8_upgrade_v1_2.js --network mainnet --compile false
node_modules/.bin/etherlime deploy --file deployment/9_upgrade_v1_3.js --network mainnet --compile false
node_modules/.bin/etherlime deploy --file deployment/10_upgrade_v1_4.js --network mainnet --compile false
node_modules/.bin/etherlime deploy --file deployment/11_1_deploy_contracts_v141.js --network mainnet --compile false
node_modules/.bin/etherlime deploy --file deployment/11_2_deploy_contracts_v142.js --network mainnet --compile false
node_modules/.bin/etherlime deploy --file deployment/11_4_deploy_contracts_v144.js --network mainnet --compile false