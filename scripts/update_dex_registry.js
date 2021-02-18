// ///////////////////////////////////////////////////////////////////
// Script to register and deregister DEXes in the DexRegistry contract
//
// Can be executed as:
// ./execute_script.sh update_dex_registry.js <network> --dex <dex address>=<dex status>
//
// where:
//     - network = [development, test, staging, prod]
//      - dex status = [true, false]
// ////////////////////////////////////////////////////////////////////

/* global artifacts */
global.web3 = web3;

const MultiSig = artifacts.require("MultiSigWallet");
const DexRegistry = artifacts.require("DexRegistry");

const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  const dexAddress = [];
  const dexStatus = [];

  // Read Command Line Arguments
  const idx = process.argv.indexOf("--dex");

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

  const { deploymentAccount, configurator } = await deployManager.getProps();
  const { config } = configurator;

  const DexRegistryWrapper = await DexRegistry.at(config.contracts.DexRegistry);
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  console.log(`Updating registry for dex [${dexAddress}] with value [${dexStatus}]`);
  await multisigExecutor.executeCall(DexRegistryWrapper, "setAuthorised", [dexAddress, dexStatus]);
}

module.exports = (cb) => main().then(cb).catch(cb);
