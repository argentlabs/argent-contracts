// ///////////////////////////////////////////////////////////////////
// Script to deploy a new WalletFactory contract
//
// Can be executed as:
// ./scripts/execute_script.sh --no-compile scripts/deploy_wallet_factory.js <network>
//
// where:
//     - network = [development, test, staging, prod]
// ////////////////////////////////////////////////////////////////////

/* global artifacts */
global.web3 = web3;

const WalletFactory = artifacts.require("WalletFactory");

const deployManager = require("../utils/deploy-manager.js");

async function main() {
  const { configurator, abiUploader } = await deployManager.getProps();
  const { config } = configurator;
  console.log("Config:", config);

  // Deploy new WalletFactory
  console.log("Deploying new WalletFactory...");
  const NewWalletFactoryWrapper = await WalletFactory.new(
    config.contracts.ModuleRegistry,
    config.contracts.BaseWallet,
    config.modules.GuardianStorage,
    config.backend.refundCollector);

  console.log("WalletFactory deployed at", NewWalletFactoryWrapper.address);

  console.log("Setting the backend accounts as managers for the new WalletFactory...");
  for (let idx = 0; idx < config.backend.accounts.length; idx += 1) {
    const account = config.backend.accounts[idx];
    // Set `account` as the manager of the WalletFactory
    await NewWalletFactoryWrapper.addManager(account);
  }

  console.log("Setting the multisig as the owner of the new WalletFactory...");
  await NewWalletFactoryWrapper.changeOwner(config.contracts.MultiSigWallet);

  console.log("Saving new config...");
  configurator.updateInfrastructureAddresses({ WalletFactory: NewWalletFactoryWrapper.address });
  await configurator.save();

  await abiUploader.upload(NewWalletFactoryWrapper, "contracts");

  console.log("WalletFactory Update DONE.");
}

module.exports = (cb) => main().then(cb).catch(cb);
