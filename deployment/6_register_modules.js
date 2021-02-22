/* global artifacts */

global.web3 = web3;

const ModuleRegistry = artifacts.require("ModuleRegistry");
const MultiSig = artifacts.require("MultiSigWallet");

const ArgentModule = artifacts.require("ArgentModule");

const utils = require("../utils/utilities.js");
const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  const { deploymentAccount, configurator, versionUploader } = await deployManager.getProps();
  const { config } = configurator;

  const ArgentModuleWrapper = await ArgentModule.at(config.modules.ArgentModule);
  const ModuleRegistryWrapper = await ModuleRegistry.at(config.contracts.ModuleRegistry);
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);

  const wrappers = [ArgentModuleWrapper];

  // //////////////////////////////////
  // Register and configure module wrappers
  // //////////////////////////////////

  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  for (let idx = 0; idx < wrappers.length; idx += 1) {
    const wrapper = wrappers[idx];
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule",
      [wrapper.address, utils.asciiToBytes32(wrapper.constructor.contractName)]);
  }

  // //////////////////////////////////
  // Upload Version
  // //////////////////////////////////

  const modules = wrappers.map((wrapper) => ({ address: wrapper.address, name: wrapper.constructor.contractName }));
  const version = {
    modules,
    fingerprint: utils.versionFingerprint(modules),
    version: "1.0.0",
    createdAt: Math.floor((new Date()).getTime() / 1000),
  };
  await versionUploader.upload(version);

  console.log("## completed deployment script 6 ##");
}

// For truffle exec
module.exports = function (callback) {
  main().then(() => callback()).catch((err) => callback(err));
};
