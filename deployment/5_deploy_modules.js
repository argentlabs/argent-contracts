/* global artifacts */

global.web3 = web3;

const childProcess = require("child_process");

const ArgentModule = artifacts.require("ArgentModule");

const deployManager = require("../utils/deploy-manager.js");

// ///////////////////////////////////////////////////////
//                 Version 2.5
// ///////////////////////////////////////////////////////

async function main() {
  const { configurator, abiUploader } = await deployManager.getProps();
  const { config } = configurator;

  // //////////////////////////////////
  // Deploy modules
  // //////////////////////////////////

  // Deploy ArgentModule
  const ArgentModuleWrapper = await ArgentModule.new(
    config.contracts.ModuleRegistry,
    config.modules.GuardianStorage,
    config.modules.TransferStorage,
    config.contracts.Authoriser,
    config.defi.uniswap.v2Router,
    config.settings.securityPeriod || 0,
    config.settings.securityWindow || 0,
    config.settings.lockPeriod || 0,
    config.settings.recoveryPeriod || 0);

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

  console.log("## completed deployment script 5 ##");
}

// For truffle exec
module.exports = function (callback) {
  main().then(() => callback()).catch((err) => callback(err));
};
