// ///////////////////////////////////////////////////////////////////
// Script to deploy a Wallet Factory.
//
// To add a new wallet factory:
// ./execute_script.sh deploy_wallet_factory.js <network> --owner <owner address>
//
// where:
//    - network = [test, staging, prod]
// ////////////////////////////////////////////////////////////////////

const WalletFactory = require("../build/WalletFactory");
const DeployManager = require("../utils/deploy-manager.js");

async function main() {

  // Read Command Line Arguments
  let idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];

  idx = process.argv.indexOf("--owner");
  const owner = process.argv[idx + 1];

  // Setup deployer
  const manager = new DeployManager(network);
  await manager.setup();
  const { configurator } = manager;
  const { deployer } = manager;
  const { config } = configurator;

  const WalletFactoryWrapper = await deployer.deploy(WalletFactory, {},
    config.contracts.ModuleRegistry, config.contracts.BaseWallet, config.modules.GuardianStorage);
  console.log("Wallet Factory deployed at " + WalletFactoryWrapper.contractAddress);

  const WalletFactoryAddManagerTx = await WalletFactoryWrapper.contract.addManager(owner);
  await WalletFactoryWrapper.verboseWaitForTransaction(WalletFactoryAddManagerTx, `Set ${owner} as the manager of the WalletFactory`);

  const WalletFactoryChangeOwnerTx = await WalletFactoryWrapper.contract.changeOwner(owner);
    await WalletFactoryWrapper.verboseWaitForTransaction(WalletFactoryChangeOwnerTx, `Set ${owner} as the owner of the WalletFactory`);
}

main().catch((err) => {
  throw err;
});
