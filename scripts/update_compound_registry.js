// ///////////////////////////////////////////////////////////////////
// Script to add/remove CTokens on Compound
//
// To add a token:
// ./execute_script.sh update_compound_registry.js <network> --add --token <token address> --ctoken <ctoken address>
//
// To remove a token:
// ./execute_script.sh update_compound_registry.js <network> --remove --token <token address>
//
// where:
//    - network = [development, test, staging, prod]
// ////////////////////////////////////////////////////////////////////

/* global artifacts */
const CompoundRegistry = artifacts.require("CompoundRegistry");
const MultiSig = artifacts.require("MultiSigWallet");

const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  let add;

  // Read Command Line Arguments
  let idx = process.argv.indexOf("--add");
  if (idx > 0) {
    add = true;
  } else {
    idx = process.argv.indexOf("--remove");
    if (idx > 0) {
      add = false;
    } else {
      console.log("Error: Use --add or --remove to add or remove tokens from Compound");
      return;
    }
  }

  idx = process.argv.indexOf("--token");
  const token = process.argv[idx + 1];

  idx = process.argv.indexOf("--ctoken");
  const ctoken = process.argv[idx + 1];

  const { configurator } = await deployManager.getProps();
  const { config } = configurator;
  const accounts = await web3.eth.getAccounts();
  const deploymentAccount = accounts[0];

  const CompoundRegistryWrapper = await CompoundRegistry.at(config.contracts.CompoundRegistry);
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  if (add) {
    console.log(`Adding token ${token} to Compound`);
    await multisigExecutor.executeCall(CompoundRegistryWrapper, "addCToken", [token, ctoken]);
  } else {
    console.log(`Removing token ${token} from Compound`);
    await multisigExecutor.executeCall(CompoundRegistryWrapper, "removeCToken", [token]);
  }
}

module.exports = (cb) => main().then(cb).catch(cb);
