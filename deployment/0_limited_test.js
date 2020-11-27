/* global artifacts */
global.web3 = web3;
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));

const TestOwnedContract = artifacts.require("TestOwnedContract");
const MultiSig = artifacts.require("MultiSigWallet");

const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  const { deploymentAccount, configurator } = await deployManager.getProps();
  console.log("deploymentAccount", deploymentAccount);
  const { config } = configurator;

  const testContractWrapper = await TestOwnedContract.new();
  console.log("TestOwnedContract created at", testContractWrapper.address);

  await testContractWrapper.changeOwner(config.contracts.MultiSigWallet);
  console.log("Set the MultiSig as the owner of TestOwnedContract");

  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);
  await multisigExecutor.executeCall(testContractWrapper, "setStateRestricted", [99]);
  const stateValue = await testContractWrapper.state();
  expect(stateValue).to.eq.BN(99);

  console.log("## completed deployment script 7 ##");
}

// For truffle exec
module.exports = function (callback) {
  main().then(() => callback()).catch((err) => callback(err));
};
