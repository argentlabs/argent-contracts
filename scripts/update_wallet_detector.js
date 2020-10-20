// ///////////////////////////////////////////////////////////////////
// Script to add a new wallet version (code and/or implementation) to the ArgentWalletDetector.
//
// ////////////////////////// WARNING ///////////////////////////////////////////////
// There is only one instance deployed that detects wallets for both staging and prod.
// //////////////////////////////////////////////////////////////////////////////////
//
// To add a new wallet (code + implementation):
// ./execute_script.sh update_wallet_detector.js <network> --wallet <wallet address>
//
// To add a new implementation:
// ./execute_script.sh update_wallet_detector.js <network> --implementation <wallet implementation>
//
// To add a new code:
// ./execute_script.sh update_wallet_detector.js <network> --code <wallet code>
//
// where:
//    - network = [test, prod]
// ////////////////////////////////////////////////////////////////////

const ArgentWalletDetector = require("../build/ArgentWalletDetector");
const MultiSig = require("../build/MultiSigWallet");

const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  let wallet;
  let code;
  let implementation;

  // Read Command Line Arguments
  let idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];

  idx = process.argv.indexOf("--wallet");
  if (idx > 0) {
    wallet = process.argv[idx + 1];
  } else {
    idx = process.argv.indexOf("--implementation");
    if (idx > 0) {
      implementation = process.argv[idx + 1];
    } else {
      idx = process.argv.indexOf("--code");
      if (idx > 0) {
        code = process.argv[idx + 1];
      } else {
        console.log("Error: No argument provided");
        return;
      }
    }
  }

  // Setup deployer
  const manager = new DeployManager(network);
  await manager.setup();
  const { configurator } = manager;
  const { deployer } = manager;
  const deploymentWallet = deployer.signer;
  const { config } = configurator;

  const ArgentWalletDetectorWrapper = await deployer.wrapDeployedContract(ArgentWalletDetector, config.contracts.ArgentWalletDetector);
  const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

  if (wallet) {
    console.log(`Adding wallet code and implementation from ${wallet}`);
    await multisigExecutor.executeCall(ArgentWalletDetectorWrapper, "addCodeAndImplementationFromWallet", [wallet]);
  } else if (code) {
    console.log(`Adding wallet code ${code}`);
    await multisigExecutor.executeCall(ArgentWalletDetectorWrapper, "addCode", [code]);
  } else if (implementation) {
    console.log(`Adding wallet implementation ${implementation}`);
    await multisigExecutor.executeCall(ArgentWalletDetectorWrapper, "addImplementation", [implementation]);
  }
}

main().catch((err) => {
  throw err;
});
