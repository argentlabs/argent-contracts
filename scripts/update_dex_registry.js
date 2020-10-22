// ///////////////////////////////////////////////////////////////////
// Script to register and deregister DEXes in the DexRegistry contract
//
// Can be executed as:
// ./execute_script.sh update_dex_registry.js <network> --dex <dex address>=<dex status>
//
// where:
//     - network = [ganache, test, staging, prod]
//      - dex status = [true, false]
// ////////////////////////////////////////////////////////////////////

/* global artifacts */
const MultiSig = artifacts.require("MultiSigWallet");
const DexRegistry = artifacts.require("DexRegistry");

const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  const dexAddress = [];
  const dexStatus = [];

  // Read Command Line Arguments
  let idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];

  idx = process.argv.indexOf("--dex");

  const { length } = process.argv;
  for (let i = idx + 1; i < length; i += 1) {
    const pair = process.argv[i].split("=");
    if (pair[1] !== "true" && pair[1] !== "false") {
      console.log("Error: invalid boolean value");
      return;
    }
    dexAddress.push(pair[0]);
    dexStatus.push(pair[1] === "true");
  }

  // Setup deployer
  const manager = new DeployManager(network);
  await manager.setup();
  const { configurator } = manager;
  const { deployer } = manager;
  const deploymentWallet = deployer.signer;
  const { config } = configurator;

  const DexRegistryWrapper = await deployer.wrapDeployedContract(DexRegistry, config.contracts.DexRegistry);
  const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

  console.log(`Updating registry for dex [${dexAddress}] with value [${dexStatus}]`);
  await multisigExecutor.executeCall(DexRegistryWrapper, "setAuthorised", [dexAddress, dexStatus]);
}

main().catch((err) => {
  throw err;
});
