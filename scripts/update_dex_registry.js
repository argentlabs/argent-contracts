/////////////////////////////////////////////////////////////////////
// Script to register and deregister DEXes in the DexRegistry contract
//
// Can be executed as:
// ./execute_script.sh update_dex_registry.js <network> --dex <dex address>=<dex status>
//
// where:
//     - network = [test, staging, prod]
//      - dex status = [true, false]
//////////////////////////////////////////////////////////////////////

const MultiSig = require("../build/MultiSigWallet");
const DexRegistry = require("../build/DexRegistry");

const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {

  const dex_address = [];
  const dex_status = [];

  // Read Command Line Arguments
  let idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];

  idx = process.argv.indexOf("--dex");

  let length = process.argv.length; 
  for (i = idx + 1; i < length; i++) {
    let pair = process.argv[i].split("=");
    if(pair[1] != 'true' && pair[1] != 'false') {
      console.log("Error: invalid boolean value");
      return;
    }
    dex_address.push(pair[0]);
    dex_status.push(pair[1] == 'true');
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

  console.log(`Updating registry for dex [${dex_address}] with value [${dex_status}]`);
  await multisigExecutor.executeCall(DexRegistryWrapper, "setAuthorised", [dex_address, dex_status]);

}

main().catch((err) => {
  throw err;
});