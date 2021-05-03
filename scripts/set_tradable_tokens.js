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

/* global artifacts */
global.web3 = web3;
global.artifacts = artifacts;

const fs = require("fs");
const inquirer = require("inquirer");

const MultiSig = artifacts.require("MultiSigWallet");
const TokenRegistry = artifacts.require("TokenRegistry");

const MultisigExecutor = require("../utils/multisigexecutor.js");
const deployManager = require("../utils/deploy-manager.js");

async function main() {
  // Read Command Line Arguments
  let idx = process.argv.indexOf("--input");
  const input = process.argv[idx + 1];

  idx = process.argv.indexOf("--dry");
  const dry = (idx !== -1);

  const { configurator } = await deployManager.getProps();
  const { config } = configurator;
  const accounts = await web3.eth.getAccounts();
  const deploymentAccount = accounts[0];

  const TokenRegistryWrapper = await TokenRegistry.at(config.contracts.TokenRegistry);

  const data = JSON.parse(fs.readFileSync(input, "utf8"));
  const addresses = Object.keys(data);
  console.log(`${addresses.length} tokens provided in ${input}`);

  const tradableStatus = await TokenRegistryWrapper.getTradableForTokenList(addresses);

  // we only update tokens meeting this condition:
  // (1) tradable flag is different than the one on chain
  const filteredData = Object.entries(data).filter((item, index) => (tradableStatus[index] !== item[1]));

  console.log(`${filteredData.length} tokens need update:`);
  for (const item of filteredData) {
    console.log(item[0], item[1]);
  }

  if (dry) return;

  const tokens = filteredData.map((item) => item[0]);
  const tradable = filteredData.map((item) => item[1]);

  const owner = await TokenRegistryWrapper.owner();

  if (owner.toLowerCase() === config.contracts.MultiSigWallet.toLowerCase()) {
    const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign, true);
    const receipt = await multisigExecutor.executeCall(TokenRegistryWrapper, "setTradableForTokenList", [tokens, tradable]);
    console.log(receipt.transactionHash);
  } else if (owner.toLowerCase() === deploymentAccount.toLowerCase()) {
    const estimateGas = await TokenRegistryWrapper.setTradableForTokenList.estimateGas(tokens, tradable, { gas: 10000000 });

    const { gasPriceGwei, gasLimit } = await inquirer.prompt([{
      type: "number",
      name: "gasLimit",
      message: "Gas Limit",
      default: estimateGas.toString(),
    }, {
      type: "number",
      name: "gasPriceGwei",
      message: "Gas Price (gwei)",
      default: 50,
    }]);

    const options = {
      gas: parseInt(gasLimit, 10),
      gasPrice: web3.utils.toWei(String(gasPriceGwei), "gwei")
    };
    const receipt = await TokenRegistryWrapper.setTradableForTokenList(tokens, tradable, options);
    console.log(receipt.transactionHash);
  }
}

module.exports = (callback) => {
  // perform actions
  main().then(() => callback()).catch((err) => callback(err));
};
