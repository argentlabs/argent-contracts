// Usage: ./execute.sh set_tradable_tokens.js staging --input [filename] (--dry)
//
// --input [filename]: path to json file formatted like this:
//      {
//        "0xE41d2489571d322189246DaFA5ebDe1F4699F498": true,
//        "0xc00e94Cb662C3520282E6f5717214004A7f26888": true,
//        "0x0d438f3b5175bebc262bf23753c1e53d03432bde": false
//      }
//
// --dry: if set, will not send the transaction, just output what will be updated
//

const fs = require("fs");
const ethers = require("ethers");
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

  idx = process.argv.indexOf("--dry");
  const dry = (idx !== -1);

  // Setup deployer
  const manager = new DeployManager(network);
  await manager.setup();
  const { configurator } = manager;
  const { deployer } = manager;
  const deploymentWallet = deployer.signer;
  const { config } = configurator;
  const { gasPrice, gasLimit } = deployer.defaultOverrides;

  const TokenPriceRegistryWrapper = await deployer.wrapDeployedContract(TokenPriceRegistry, config.modules.TokenPriceRegistry);

  const data = JSON.parse(fs.readFileSync(input, "utf8"));
  const addresses = Object.keys(data);
  console.log(`${addresses.length} tokens provided in ${input}`);

  const tradableStatus = await TokenPriceRegistryWrapper.getTradableForTokenList(addresses);
  const priceStatus = await TokenPriceRegistryWrapper.getPriceForTokenList(addresses);

  // we only update tokens meeting those two conditions:
  // (1) tradable flag is different than the one on chain
  // (2) on chain price is not zero
  const filteredData = Object.entries(data).filter((item, index) => (tradableStatus[index] !== item[1]) && (priceStatus[index].isZero() === false));

  console.log(`${filteredData.length} tokens need update:`);
  for (const item of filteredData) {
    console.log(item[0], item[1]);
  }

  console.log("gasPrice", ethers.utils.formatUnits(gasPrice, "gwei"));
  console.log("gasLimit", gasLimit);

  if (dry) return;

  const tokens = filteredData.map((item) => item[0]);
  const tradable = filteredData.map((item) => item[1]);

  const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign, { gasPrice, gasLimit });
  await multisigExecutor.executeCall(TokenPriceRegistryWrapper, "setTradableForTokenList", [tokens, tradable]);
}

main().catch((err) => {
  throw err;
});
