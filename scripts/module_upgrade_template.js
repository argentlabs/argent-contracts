/* global artifacts */
global.web3 = web3;

const semver = require("semver");
const childProcess = require("child_process");

const MultiSig = artifacts.require("MultiSigWallet");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const VersionManager = artifacts.require("VersionManager");
const Upgrader = artifacts.require("UpgraderToVersionManager");

const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const utils = require("../utils/utilities.js");

const TARGET_VERSION = "2.1.0";
const MODULES_TO_ENABLE = [
  "VersionManager",
];
const MODULES_TO_DISABLE = [];

const BACKWARD_COMPATIBILITY = 3;

const main = async (network) => {
  if (!["kovan", "kovan-fork", "staging", "prod"].includes(network)) {
    console.warn("------------------------------------------------------------------------");
    console.warn(`WARNING: The MakerManagerV2 module is not fully functional on ${network}`);
    console.warn("------------------------------------------------------------------------");
  }

  const newModuleWrappers = [];
  const newVersion = {};

  // //////////////////////////////////
  // Setup
  // //////////////////////////////////
  const { deploymentAccount, configurator, versionUploader } = await deployManager.getProps();
  const { config } = configurator;

  const ModuleRegistryWrapper = await ModuleRegistry.at(config.contracts.ModuleRegistry);
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  // //////////////////////////////////
  // Initialise the new version
  // //////////////////////////////////
  const VersionManagerWrapper = await VersionManager.at(config.modules.VersionManager);

  // //////////////////////////////////
  // Setup new infrastructure
  // //////////////////////////////////

  // //////////////////////////////////
  // Set contracts' managers
  // //////////////////////////////////

  // //////////////////////////////////
  // Set contracts' owners
  // //////////////////////////////////

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////

  configurator.updateModuleAddresses({
  });

  configurator.updateInfrastructureAddresses({
  });

  const gitHash = childProcess.execSync("git rev-parse HEAD").toString("utf8").replace(/\n$/, "");
  configurator.updateGitHash(gitHash);
  await configurator.save();

  await Promise.all([
  ]);

  // //////////////////////////////////
  // Register new modules
  // //////////////////////////////////

  for (let idx = 0; idx < newModuleWrappers.length; idx += 1) {
    const wrapper = newModuleWrappers[idx];
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule",
      [wrapper.contractAddress, utils.asciiToBytes32(wrapper.constructor.contractName)]);
  }

  // //////////////////////////////////
  // Deploy and Register upgraders
  // //////////////////////////////////

  let fingerprint;
  const versions = await versionUploader.load(BACKWARD_COMPATIBILITY);
  for (let idx = 0; idx < versions.length; idx += 1) {
    const version = versions[idx];
    let toAdd; let toRemove;
    if (idx === 0) {
      const moduleNamesToRemove = MODULES_TO_DISABLE.concat(MODULES_TO_ENABLE);
      toRemove = version.modules.filter((module) => moduleNamesToRemove.includes(module.name));
      toAdd = newModuleWrappers.map((wrapper) => ({
        address: wrapper.contractAddress,
        name: wrapper.constructor.contractName,
      }));
      const toKeep = version.modules.filter((module) => !moduleNamesToRemove.includes(module.name));
      const modulesInNewVersion = toKeep.concat(toAdd);
      fingerprint = utils.versionFingerprint(modulesInNewVersion);
      newVersion.version = semver.lt(version.version, TARGET_VERSION) ? TARGET_VERSION : semver.inc(version.version, "patch");
      newVersion.createdAt = Math.floor((new Date()).getTime() / 1000);
      newVersion.modules = modulesInNewVersion;
      newVersion.fingerprint = fingerprint;
    } else {
      // add all modules present in newVersion that are not present in version
      toAdd = newVersion.modules.filter((module) => !version.modules.map((m) => m.address).includes(module.address));
      // remove all modules from version that are no longer present in newVersion
      toRemove = version.modules.filter((module) => !newVersion.modules.map((m) => m.address).includes(module.address));
    }

    const upgraderName = `${version.fingerprint}_${fingerprint}`;

    const UpgraderWrapper = await Upgrader.new(
      config.contracts.ModuleRegistry,
      config.modules.GuardianStorage, // using the "old LockStorage" here which was part of the GuardianStorage in 1.6
      toRemove.map((module) => module.address),
      VersionManagerWrapper.contractAddress, // to add
    );
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule",
      [UpgraderWrapper.contractAddress, utils.asciiToBytes32(upgraderName)]);

    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerUpgrader",
      [UpgraderWrapper.contractAddress, utils.asciiToBytes32(upgraderName)]);
  }

  // //////////////////////////////////
  // Upload Version
  // //////////////////////////////////

  await versionUploader.upload(newVersion);
};

main().catch((err) => {
  throw err;
});
