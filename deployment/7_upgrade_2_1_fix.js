const semver = require("semver");
const childProcess = require("child_process");
const MultiSig = require("../build/MultiSigWallet");
const ModuleRegistry = require("../build/ModuleRegistry");
const Upgrader = require("../build/UpgraderToVersionManager");
const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const ApprovedTransfer = require("../build/ApprovedTransfer");
const CompoundManager = require("../build/CompoundManager");
const GuardianManager = require("../build/GuardianManager");
const LockManager = require("../build/LockManager");
const NftTransfer = require("../build/NftTransfer");
const RecoveryManager = require("../build/RecoveryManager");
const TokenExchanger = require("../build/TokenExchanger");
const MakerV2Manager = require("../build/MakerV2Manager");
const TransferManager = require("../build/TransferManager");
const RelayerManager = require("../build/RelayerManager");
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

  // //////////////////////////////////
  // Deploy new features
  // //////////////////////////////////
  const ApprovedTransferWrapper = await deployer.deploy(
    ApprovedTransfer,
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    config.modules.LimitStorage,
    VersionManagerWrapper.contractAddress,
    config.defi.weth,
  );

  const CompoundManagerWrapper = await deployer.deploy(
    CompoundManager,
    {},
    config.modules.LockStorage,
    config.defi.compound.comptroller,
    config.contracts.CompoundRegistry,
    VersionManagerWrapper.contractAddress,
  );

  const GuardianManagerWrapper = await deployer.deploy(
    GuardianManager,
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    VersionManagerWrapper.contractAddress,
    config.settings.securityPeriod || 0,
    config.settings.securityWindow || 0,
  );

  const LockManagerWrapper = await deployer.deploy(
    LockManager,
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    VersionManagerWrapper.contractAddress,
    config.settings.lockPeriod || 0,
  );

  const NftTransferWrapper = await deployer.deploy(
    NftTransfer,
    {},
    config.modules.LockStorage,
    config.modules.TokenPriceRegistry,
    VersionManagerWrapper.contractAddress,
    config.CryptoKitties.contract,
  );

  const RecoveryManagerWrapper = await deployer.deploy(
    RecoveryManager,
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    VersionManagerWrapper.contractAddress,
    config.settings.recoveryPeriod || 0,
    config.settings.lockPeriod || 0,
  );

  const TokenExchangerWrapper = await deployer.deploy(
    TokenExchanger,
    {},
    config.modules.LockStorage,
    config.modules.TokenPriceRegistry,
    VersionManagerWrapper.contractAddress,
    config.contracts.DexRegistry,
    config.defi.paraswap.contract,
    "argent",
  );

  const MakerV2ManagerWrapper = await deployer.deploy(
    MakerV2Manager,
    {},
    config.modules.LockStorage,
    config.defi.maker.migration,
    config.defi.maker.pot,
    config.defi.maker.jug,
    config.contracts.MakerRegistry,
    config.defi.uniswap.factory,
    VersionManagerWrapper.contractAddress,
  );

  const TransferManagerWrapper = await deployer.deploy(
    TransferManager,
    {},
    config.modules.LockStorage,
    config.modules.TransferStorage,
    config.modules.LimitStorage,
    config.modules.TokenPriceRegistry,
    VersionManagerWrapper.contractAddress,
    config.settings.securityPeriod || 0,
    config.settings.securityWindow || 0,
    config.settings.defaultLimit || "1000000000000000000",
    config.defi.weth,
    ["test", "staging", "prod"].includes(network) ? config.modules.TransferManager : "0x0000000000000000000000000000000000000000",
  );

  const RelayerManagerWrapper = await deployer.deploy(
    RelayerManager,
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    config.modules.LimitStorage,
    config.modules.TokenPriceRegistry,
    VersionManagerWrapper.contractAddress,
  );

  // Add Features to Version Manager
  const newFeatures = [
    GuardianManagerWrapper.contractAddress,
    LockManagerWrapper.contractAddress,
    RecoveryManagerWrapper.contractAddress,
    ApprovedTransferWrapper.contractAddress,
    TransferManagerWrapper.contractAddress,
    TokenExchangerWrapper.contractAddress,
    NftTransferWrapper.contractAddress,
    CompoundManagerWrapper.contractAddress,
    MakerV2ManagerWrapper.contractAddress,
    RelayerManagerWrapper.contractAddress,
  ];
  const newFeaturesWithNoInit = [ // all features except the TransferManager
    GuardianManagerWrapper.contractAddress,
    LockManagerWrapper.contractAddress,
    RecoveryManagerWrapper.contractAddress,
    ApprovedTransferWrapper.contractAddress,
    TokenExchangerWrapper.contractAddress,
    NftTransferWrapper.contractAddress,
    CompoundManagerWrapper.contractAddress,
    MakerV2ManagerWrapper.contractAddress,
    RelayerManagerWrapper.contractAddress,
  ];
  const newFeatureToInit = newFeatures.filter((f) => !newFeaturesWithNoInit.includes(f));
  const VersionManagerAddVersionTx = await VersionManagerWrapper.contract.addVersion(newFeatures, newFeatureToInit, { gasPrice });
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
    ApprovedTransfer: ApprovedTransferWrapper.contractAddress,
    CompoundManager: CompoundManagerWrapper.contractAddress,
    GuardianManager: GuardianManagerWrapper.contractAddress,
    LockManager: LockManagerWrapper.contractAddress,
    NftTransfer: NftTransferWrapper.contractAddress,
    RecoveryManager: RecoveryManagerWrapper.contractAddress,
    TokenExchanger: TokenExchangerWrapper.contractAddress,
    MakerV2Manager: MakerV2ManagerWrapper.contractAddress,
    TransferManager: TransferManagerWrapper.contractAddress,
    RelayerManager: RelayerManagerWrapper.contractAddress,

    VersionManager: VersionManagerWrapper.contractAddress,
  });

  const gitHash = childProcess.execSync("git rev-parse HEAD").toString("utf8").replace(/\n$/, "");
  configurator.updateGitHash(gitHash);
  await configurator.save();

  await Promise.all([
    abiUploader.upload(ApprovedTransferWrapper, "modules"),
    abiUploader.upload(CompoundManagerWrapper, "modules"),
    abiUploader.upload(GuardianManagerWrapper, "modules"),
    abiUploader.upload(LockManagerWrapper, "modules"),
    abiUploader.upload(NftTransferWrapper, "modules"),
    abiUploader.upload(RecoveryManagerWrapper, "modules"),
    abiUploader.upload(TokenExchangerWrapper, "modules"),
    abiUploader.upload(MakerV2ManagerWrapper, "modules"),
    abiUploader.upload(TransferManagerWrapper, "modules"),
    abiUploader.upload(RelayerManagerWrapper, "modules"),

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
