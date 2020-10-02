const fs = require("fs");
const MultiSig = require("../build/MultiSigWallet");
const TokenPriceRegistry = require("../build/TokenPriceRegistry");

const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  // Read Command Line Arguments
  let idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];

  idx = process.argv.indexOf("--input");
  const input = process.argv[idx + 1];

  // Setup deployer
  const manager = new DeployManager(network);
  await manager.setup();
  const { configurator } = manager;
  const { deployer } = manager;
  const deploymentWallet = deployer.signer;
  const { config } = configurator;

  const TokenPriceStorageWrapper = await deployer.wrapDeployedContract(TokenPriceRegistry, config.modules.TokenPriceRegistry);

  const tokens = JSON.parse(fs.readFileSync(input, "utf8"));
  const tradable = Array(tokens.length).fill(true);

  // const res = await TokenPriceStorageWrapper.getTradableForTokenList(tokens);
  // const res = await TokenPriceStorageWrapper.getPriceForTokenList(tokens);

  const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign, { gasPrice: 150e9, gasLimit: 2000000 });
  await multisigExecutor.executeCall(TokenPriceStorageWrapper, "setTradableForTokenList", [tokens, tradable]);
}

main().catch((err) => {
  throw err;
});
