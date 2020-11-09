// ///////////////////////////////////////////////////////////////////
// Script to add/remove a module from the ModuleRegistry
//
// To register a module:
// ./execute_script.sh update_module_registry.js <network> --add --module <module address> --name <module name>
//
// To deregister a module:
// ./execute_script.sh update_module_registry.js <network> --remove --module <module address>
//
// where:
//    - network = [development, test, staging, prod]
// ////////////////////////////////////////////////////////////////////

/* global artifacts */
const ModuleRegistry = artifacts.require("ModuleRegistry");
const MultiSig = artifacts.require("MultiSigWallet");

const utils = require("../utils/utilities.js");
const DeployManager = require("../utils/deploy-manager.js");
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
      console.log("Error: Use --add or --remove to add or remove modules from the ModuleRegistry");
      return;
    }
  }

  idx = process.argv.indexOf("--module");
  const targetModule = process.argv[idx + 1];

  idx = process.argv.indexOf("--name");
  const targetName = process.argv[idx + 1];

  // Setup deployer
  // TODO: Maybe get the signer account a better way?
  const accounts = await web3.eth.getAccounts();
  const deploymentAccount = accounts[0];
  const manager = new DeployManager(deploymentAccount);
  await manager.setup();
  const { configurator } = manager;
  const { config } = configurator;

  const ModuleRegistryWrapper = await ModuleRegistry.at(config.contracts.ModuleRegistry);
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  if (add) {
    console.log(`Registering module ${targetName} to ModuleRegistry`);
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule", [targetModule, utils.asciiToBytes32(targetName)]);
  } else {
    console.log(`Deregistering module ${targetName} from ModuleRegistry`);
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "deregisterModule", [targetModule]);
  }
}

main().catch((err) => {
  throw err;
});
