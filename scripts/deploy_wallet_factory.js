// ///////////////////////////////////////////////////////////////////
// Script to deploy a new WalletFactory contract
//
// Can be executed as:
// ./execute_script.sh --no-compile deploy_wallet_factory.js <network>
//
// where:
//     - network = [development, test, staging, prod]
// ////////////////////////////////////////////////////////////////////

/* global artifacts */
global.web3 = web3;

const WalletFactory = artifacts.require("WalletFactory");

const deployManager = require("../utils/deploy-manager.js");

async function main() {
  const { configurator } = await deployManager.getProps();
  const { config } = configurator;
  console.log("Config:", config);

  // Deploy new WalletFactory
  console.log("Deploying new WalletFactory...");
  const NewWalletFactoryWrapper = await WalletFactory.new(
    config.contracts.ModuleRegistry,
    config.contracts.BaseWallet,
    config.modules.GuardianStorage,
    config.backend.refundCollector);

  // Set the backend keys as managers for the new WalletFactory
  for (idx in config.backend.accounts) {
    let account = config.backend.accounts[idx];
    const WalletFactoryAddManagerTx = await NewWalletFactoryWrapper.contract.addManager(account);
    await NewWalletFactoryWrapper.verboseWaitForTransaction(WalletFactoryAddManagerTx, `Set ${account} as the manager of the WalletFactory`);
}

  // Set the multisig as the owner of the new WalletFactory
  const changeOwnerTx = await NewWalletFactoryWrapper.contract.changeOwner(config.contracts.MultiSigWallet);
  await NewWalletFactoryWrapper.verboseWaitForTransaction(changeOwnerTx, `Set the MultiSig as the owner of the WalletFactory`);

  console.log("Saving new config...");
  configurator.updateInfrastructureAddresses({ WalletFactory: NewWalletFactoryWrapper.address });
  await configurator.save();
  await deployManager.abiUploader.upload(NewWalletFactoryWrapper, "contracts");

  console.log("WalletFactory Update DONE.");
}

module.exports = (cb) => main().then(cb).catch(cb);
