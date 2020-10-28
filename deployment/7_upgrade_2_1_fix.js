const semver = require("semver");
const childProcess = require("child_process");
const MultiSig = require("../build/MultiSigWallet");
const ModuleRegistry = require("../build/ModuleRegistry");
const Upgrader = require("../build/UpgraderToVersionManager");
const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const VersionManager = require("../build/VersionManager");

const utils = require("../utils/utilities.js");

const TARGET_VERSION = "2.1.0";
const MODULES_TO_ENABLE = [
  "VersionManager",
];
const MODULES_TO_DISABLE = [];

const BACKWARD_COMPATIBILITY = 4;

const deploy = async (network) => {
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

  const manager = new DeployManager(network);
  await manager.setup();

  const { configurator } = manager;
  const { deployer } = manager;
  const { abiUploader } = manager;
  const { versionUploader } = manager;
  const { gasPrice } = deployer.defaultOverrides;
  const deploymentWallet = deployer.signer;
  const { config } = configurator;

  const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
  const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign, { gasPrice });

  // //////////////////////////////////
  // Deploy new modules
  // //////////////////////////////////

  const VersionManagerWrapper = await deployer.deploy(
    VersionManager,
    {},
    config.contracts.ModuleRegistry,
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    config.modules.TransferStorage,
    config.modules.LimitStorage,
  );
  newModuleWrappers.push(VersionManagerWrapper);

  // Add Features to Version Manager
  const features = [
    config.modules.GuardianManager,
    config.modules.LockManager,
    config.modules.RecoveryManager,
    config.modules.ApprovedTransfer,
    config.modules.TransferManager,
    config.modules.TokenExchanger,
    config.modules.NftTransfer,
    config.modules.CompoundManager,
    config.modules.MakerV2Manager,
    config.modules.RelayerManager,
  ];
  const featuresWithNoInit = [ // all features except the TransferManager
    config.modules.GuardianManager,
    config.modules.LockManager,
    config.modules.RecoveryManager,
    config.modules.ApprovedTransfer,
    config.modules.TokenExchanger,
    config.modules.NftTransfer,
    config.modules.CompoundManager,
    config.modules.MakerV2Manager,
    config.modules.RelayerManager,
  ];
  const featureToInit = features.filter((f) => !featuresWithNoInit.includes(f));
  const VersionManagerAddVersionTx = await VersionManagerWrapper.contract.addVersion(features, featureToInit, { gasPrice });
  await VersionManagerWrapper.verboseWaitForTransaction(VersionManagerAddVersionTx, "Adding New Version");

  // //////////////////////////////////
  // Set contracts' owners
  // //////////////////////////////////

  const changeOwnerTx = await VersionManagerWrapper.contract.changeOwner(config.contracts.MultiSigWallet, { gasPrice });
  await VersionManagerWrapper.verboseWaitForTransaction(changeOwnerTx, "Set the MultiSig as the owner of VersionManagerWrapper");

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////

  configurator.updateModuleAddresses({
    VersionManager: VersionManagerWrapper.contractAddress,
  });

  const gitHash = childProcess.execSync("git rev-parse HEAD").toString("utf8").replace(/\n$/, "");
  configurator.updateGitHash(gitHash);
  await configurator.save();

  await Promise.all([
    abiUploader.upload(VersionManagerWrapper, "modules"),
  ]);

  // //////////////////////////////////
  // Register new modules
  // //////////////////////////////////

  for (let idx = 0; idx < newModuleWrappers.length; idx += 1) {
    const wrapper = newModuleWrappers[idx];
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule",
      [wrapper.contractAddress, utils.asciiToBytes32(wrapper._contract.contractName)]);
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
        name: wrapper._contract.contractName,
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

    // if upgrading from a version strictly older than 2.1 (toRemove.length > 1), we use the "old LockStorage",
    // which was part of the GuardianStorage prior to 2.1. Otherwise (toRemove.length === 1), we use the new LockStorage introduced in 2.1
    const lockStorage = (toRemove.length === 1) ? config.modules.LockStorage : config.modules.GuardianStorage;

    const UpgraderWrapper = await deployer.deploy(
      Upgrader,
      {},
      config.contracts.ModuleRegistry,
      lockStorage,
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

module.exports = {
  deploy,
};
