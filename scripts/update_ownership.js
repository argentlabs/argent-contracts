// Usage: ./execute.sh update_ownership.js staging --address [contract_address]
//

/* global artifacts */
global.web3 = web3;
global.artifacts = artifacts;

const inquirer = require("inquirer");

const MultiSig = artifacts.require("MultiSigWallet");
const Owned = artifacts.require("Owned");

const MultisigExecutor = require("../utils/multisigexecutor.js");
const deployManager = require("../utils/deploy-manager.js");

async function main() {
  // Read Command Line Arguments
  const idx = process.argv.indexOf("--address");
  const address = process.argv[idx + 1];

  const { configurator } = await deployManager.getProps();
  const { config } = configurator;
  const accounts = await web3.eth.getAccounts();
  const deploymentAccount = accounts[0];

  const ContractWrapper = await Owned.at(address);
  const currentOwner = await ContractWrapper.owner();

  console.log("Contract Address", ContractWrapper.address);
  console.log("Current Owner", currentOwner);

  if (currentOwner.toLowerCase() === config.contracts.MultiSigWallet.toLowerCase()) {
    const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign, true);
    const receipt = await multisigExecutor.executeCall(ContractWrapper, "changeOwner", [deploymentAccount]);

    console.log(receipt.transactionHash);
  } else if (currentOwner.toLowerCase() === deploymentAccount.toLowerCase()) {
    const newOwner = config.contracts.MultiSigWallet;
    const estimateGas = await ContractWrapper.changeOwner.estimateGas(newOwner);

    const { gasPriceGwei, gasLimit, newOwnerConfirmation } = await inquirer.prompt([{
      type: "confirm",
      name: "newOwnerConfirmation",
      message: `Confirm new owner: ${newOwner}`,
      default: false,
    }, {
      type: "number",
      name: "gasLimit",
      message: "Gas Limit",
      default: estimateGas.toString(),
      when: (answers) => answers.newOwnerConfirmation
    }, {
      type: "number",
      name: "gasPriceGwei",
      message: "Gas Price (gwei)",
      default: 50,
      when: (answers) => answers.newOwnerConfirmation
    }]);

    if (newOwnerConfirmation === false) return;

    const options = {
      gas: parseInt(gasLimit, 10),
      gasPrice: web3.utils.toWei(String(gasPriceGwei), "gwei")
    };
    const receipt = await ContractWrapper.changeOwner(newOwner, options);
    console.log(receipt.transactionHash);
  }
}

module.exports = (callback) => {
  // perform actions
  main().then(() => callback()).catch((err) => callback(err));
};
