/* global artifacts */

global.web3 = web3;

const childProcess = require("child_process");

const ArgentModule = artifacts.require("ArgentModule");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const MultiSig = artifacts.require("MultiSigWallet");

const utils = require("../utils/utilities.js");
const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

// ///////////////////////////////////////////////////////
//                 Version 2.5
// ///////////////////////////////////////////////////////

async function main() {
  const { deploymentAccount, configurator, abiUploader, versionUploader } = await deployManager.getProps();
  const { config } = configurator;

  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const ModuleRegistryWrapper = await ModuleRegistry.at(config.contracts.ModuleRegistry);

  // //////////////////////////////////
  // Deploy modules
  // //////////////////////////////////

  const wrappers = [];

  // Deploy ArgentModule
  const ArgentModuleWrapper = await ArgentModule.new(
    config.contracts.ModuleRegistry,
    config.modules.GuardianStorage,
    config.modules.TransferStorage,
    config.contracts.DappRegistry,
    config.defi.uniswap.v2Router,
    config.settings.securityPeriod || 0,
    config.settings.securityWindow || 0,
    config.settings.recoveryPeriod || 0,
    config.settings.lockPeriod || 0);

  wrappers.push(ArgentModuleWrapper);

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////

  configurator.updateModuleAddresses({
    ArgentModule: ArgentModuleWrapper.address,
  });

  const gitHash = childProcess.execSync("git rev-parse HEAD").toString("utf8").replace(/\n$/, "");
  configurator.updateGitHash(gitHash);

  await configurator.save();

  await Promise.all([
    abiUploader.upload(ArgentModuleWrapper, "modules"),
  ]);

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
    version: "2.5.0",
    createdAt: Math.floor((new Date()).getTime() / 1000),
  };
  await versionUploader.upload(version);

  console.log("## completed deployment script 5 ##");
}

// For truffle exec
module.exports = function (callback) {
  main().then(() => callback()).catch((err) => callback(err));
};
