// ///////////////////////////////////////////////////////////////////
// Script to set the threshold of the Argent multisig.
//
// Can be executed as:
// ./execute_script.sh update_multisig_threshold.js <network> --threshold <new threshold>
//
// where:
//    - network = [ganache, test, staging, prod]
// ////////////////////////////////////////////////////////////////////

/* global artifacts */
const MultiSig = artifacts.require("MultiSigWallet");

const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  // Read Command Line Arguments
  let idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];

  idx = process.argv.indexOf("--threshold");
  const threshold = process.argv[idx + 1];

  // Setup deployer
  const manager = new DeployManager(network);
  await manager.setup();
  const { configurator } = manager;
  const { deployer } = manager;
  const deploymentWallet = deployer.signer;
  const { config } = configurator;

  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

  // deregister
  await multisigExecutor.executeCall(MultiSigWrapper, "changeThreshold", [threshold]);
}

main().catch((err) => {
  throw err;
});
