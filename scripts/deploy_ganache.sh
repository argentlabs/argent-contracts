#!/bin/sh

etherlime compile --runs=200
etherlime deploy --file deployment/1_setup_test_environment.js --network ganache --compile false
etherlime deploy --file deployment/2_deploy_contracts.js --network ganache --compile false
etherlime deploy --file deployment/3_setup_contracts.js --network ganache --compile false
etherlime deploy --file deployment/4_finalise_test_environment.js --network ganache --compile false
etherlime deploy --file deployment/5_deploy_modules_v1.js --network ganache --compile false
etherlime deploy --file deployment/6_register_modules_v1.js --network ganache --compile false
etherlime deploy --file deployment/7_upgrade_v1_1.js --network ganache --compile false
etherlime deploy --file deployment/8_upgrade_v1_2.js --network ganache --compile false
etherlime deploy --file deployment/9_upgrade_v1_3.js --network ganache --compile false
etherlime deploy --file deployment/10_upgrade_v1_4.js --network ganache --compile false