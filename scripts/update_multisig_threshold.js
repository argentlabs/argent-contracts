// ///////////////////////////////////////////////////////////////////
// Script to set the threshold of the Argent multisig.
//
// Can be executed as:
// ./execute_script.sh update_multisig_threshold.js <network> --threshold <new threshold>
//
// where:
//    - network = [development, test, staging, prod]
// ////////////////////////////////////////////////////////////////////

/* global artifacts */
const MultiSig = artifacts.require("MultiSigWallet");

const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  // Read Command Line Arguments
  const idx = process.argv.indexOf("--threshold");
  const threshold = process.argv[idx + 1];

  // Setup deployer
  // TODO: Maybe get the signer account a better way?
  const accounts = await web3.eth.getAccounts();
  const deploymentAccount = accounts[0];
  const manager = new DeployManager(deploymentAccount);
  await manager.setup();
  const { configurator } = manager;
  const { config } = configurator;

  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  // deregister
  await multisigExecutor.executeCall(MultiSigWrapper, "changeThreshold", [threshold]);
}

main().catch((err) => {
  throw err;
});
