<<<<<<< HEAD:scripts/update_compound_registry.js
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
//    - network = [ganache, test, staging, prod]
// ////////////////////////////////////////////////////////////////////

const CompoundRegistry = require("../build/CompoundRegistry");
const MultiSig = require("../build/MultiSigWallet");
=======
const CompoundRegistry = artifacts.require("CompoundRegistry");
const MultiSig = artifacts.require("MultiSigWallet");
>>>>>>> cd79b8da... Switch to truffle artefact loading in tests:scripts/compound.js

const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  let add;

  // Read Command Line Arguments
  let idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];

  idx = process.argv.indexOf("--add");
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

  // Setup deployer
  const manager = new DeployManager(network);
  await manager.setup();
  const { configurator } = manager;
  const { deployer } = manager;
  const deploymentWallet = deployer.signer;
  const { config } = configurator;

  const CompoundRegistryWrapper = await deployer.wrapDeployedContract(CompoundRegistry, config.contracts.CompoundRegistry);
  const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

  if (add) {
    console.log(`Adding token ${token} to Compound`);
    await multisigExecutor.executeCall(CompoundRegistryWrapper, "addCToken", [token, ctoken]);
  } else {
    console.log(`Removing token ${token} from Compound`);
    await multisigExecutor.executeCall(CompoundRegistryWrapper, "removeCToken", [token]);
  }
}

main().catch((err) => {
  throw err;
});
