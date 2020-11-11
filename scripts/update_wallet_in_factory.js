// ///////////////////////////////////////////////////////////////////
// Script to update the BaseWalet implementation in the WalletFactory contract
//
// Can be executed as:
// ./execute_script.sh update_wallet_in_factory.js <network>
//
// where:
//     - network = [ganache, test, staging, prod]
// ////////////////////////////////////////////////////////////////////

/* global artifacts */
const BaseWallet = artifacts.require("BaseWallet");
const WalletFactory = artifacts.require("WalletFactory");
const MultiSigWallet = artifacts.require("MultiSigWallet");

const MultisigExecutor = require("../utils/multisigexecutor.js");
const DeployManager = require("../utils/deploy-manager.js");

async function main() {
  // Read Command Line Arguments
  const idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];

  const deployManager = new DeployManager(network);
  await deployManager.setup();
  const { configurator } = deployManager;
  const { deployer } = deployManager;
  const manager = deployer.signer;
  const { config } = configurator;
  console.log("Config:", config);

  // Deploy new BaseWallet
  console.log("Deploying new BaseWallet...");
  const BaseWalletWrapper = await BaseWallet.new();

  // Setup WalletFactory with new BaseWallet
  console.log("Setting up WalletFactory with new BaseWallet...");
  const walletFactoryWrapper = await WalletFactory.at(config.contracts.WalletFactory);
  const multisigWrapper = await MultiSigWallet.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(multisigWrapper, manager, config.multisig.autosign);
  await multisigExecutor.executeCall(
    walletFactoryWrapper,
    "changeWalletImplementation",
    [BaseWalletWrapper.address],
  );

  console.log("Saving new config...");
  configurator.updateInfrastructureAddresses({ BaseWallet: BaseWalletWrapper.address });
  await configurator.save();
  await deployManager.abiUploader.upload(BaseWalletWrapper, "contracts");

  console.log("BaseWallet Update DONE.");
}

main().catch((err) => {
  throw err;
});
