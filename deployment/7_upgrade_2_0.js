const semver = require("semver");
const childProcess = require("child_process");
const MultiSig = require("../build/MultiSigWallet");
const ModuleRegistry = require("../build/ModuleRegistry");
const Upgrader = require("../build/UpgraderToVersionManager");
const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const LimitStorage = require("../build/LimitStorage");
const TokenPriceRegistry = require("../build/TokenPriceRegistry");
const LockStorage = require("../build/LockStorage");
const DexRegistry = require("../build/DexRegistry");

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

const BaseWallet = require("../build/BaseWallet");
const WalletFactory = require("../build/WalletFactory");

const utils = require("../utils/utilities.js");

const TARGET_VERSION = "2.1.0";
const MODULES_TO_ENABLE = [
  "VersionManager",
];
const MODULES_TO_DISABLE = [
  "MakerManager",
  "ApprovedTransfer",
  "CompoundManager",
  "GuardianManager",
  "LockManager",
  "NftTransfer",
  "RecoveryManager",
  "TokenExchanger",
  "MakerV2Manager",
  "TransferManager",
  "RelayerModule",
];

const BACKWARD_COMPATIBILITY = 3;

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
  // Deploy infrastructure contracts
  // //////////////////////////////////

  // Deploy the Base Wallet Library
  const BaseWalletWrapper = await deployer.deploy(BaseWallet);
  // Deploy the Wallet Factory
  const WalletFactoryWrapper = await deployer.deploy(WalletFactory, {},
    ModuleRegistryWrapper.contractAddress, BaseWalletWrapper.contractAddress, config.modules.GuardianStorage);
  // Deploy the new LockStorage
  const LockStorageWrapper = await deployer.deploy(LockStorage);
  // Deploy the new LimitStorage
  const LimitStorageWrapper = await deployer.deploy(LimitStorage);
  // Deploy the new TokenPriceRegistry
  const TokenPriceRegistryWrapper = await deployer.deploy(TokenPriceRegistry);
  // Deploy the DexRegistry
  const DexRegistryWrapper = await deployer.deploy(DexRegistry);

  // //////////////////////////////////
  // Deploy new modules
  // //////////////////////////////////
  const VersionManagerWrapper = await deployer.deploy(
    VersionManager,
    {},
    config.contracts.ModuleRegistry,
    LockStorageWrapper.contractAddress,
    config.modules.GuardianStorage,
    config.modules.TransferStorage,
    LimitStorageWrapper.contractAddress,
  );
  newModuleWrappers.push(VersionManagerWrapper);

  // //////////////////////////////////
  // Deploy new features
  // //////////////////////////////////
  const ApprovedTransferWrapper = await deployer.deploy(
    ApprovedTransfer,
    {},
    LockStorageWrapper.contractAddress,
    config.modules.GuardianStorage,
    LimitStorageWrapper.contractAddress,
    VersionManagerWrapper.contractAddress,
    config.defi.weth,
  );

  const CompoundManagerWrapper = await deployer.deploy(
    CompoundManager,
    {},
    LockStorageWrapper.contractAddress,
    config.defi.compound.comptroller,
    config.contracts.CompoundRegistry,
    VersionManagerWrapper.contractAddress,
  );

  const GuardianManagerWrapper = await deployer.deploy(
    GuardianManager,
    {},
    LockStorageWrapper.contractAddress,
    config.modules.GuardianStorage,
    VersionManagerWrapper.contractAddress,
    config.settings.securityPeriod || 0,
    config.settings.securityWindow || 0,
  );

  const LockManagerWrapper = await deployer.deploy(
    LockManager,
    {},
    LockStorageWrapper.contractAddress,
    config.modules.GuardianStorage,
    VersionManagerWrapper.contractAddress,
    config.settings.lockPeriod || 0,
  );

  const NftTransferWrapper = await deployer.deploy(
    NftTransfer,
    {},
    LockStorageWrapper.contractAddress,
    TokenPriceRegistryWrapper.contractAddress,
    VersionManagerWrapper.contractAddress,
    config.CryptoKitties.contract,
  );

  const RecoveryManagerWrapper = await deployer.deploy(
    RecoveryManager,
    {},
    LockStorageWrapper.contractAddress,
    config.modules.GuardianStorage,
    VersionManagerWrapper.contractAddress,
    config.settings.recoveryPeriod || 0,
    config.settings.lockPeriod || 0,
  );

  const TokenExchangerWrapper = await deployer.deploy(
    TokenExchanger,
    {},
    LockStorageWrapper.contractAddress,
    TokenPriceRegistryWrapper.contractAddress,
    VersionManagerWrapper.contractAddress,
    DexRegistryWrapper.contractAddress,
    config.defi.paraswap.contract,
    "argent",
  );

  const MakerV2ManagerWrapper = await deployer.deploy(
    MakerV2Manager,
    {},
    LockStorageWrapper.contractAddress,
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
    LockStorageWrapper.contractAddress,
    config.modules.TransferStorage,
    LimitStorageWrapper.contractAddress,
    TokenPriceRegistryWrapper.contractAddress,
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
    LockStorageWrapper.contractAddress,
    config.modules.GuardianStorage,
    LimitStorageWrapper.contractAddress,
    TokenPriceRegistryWrapper.contractAddress,
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
  // Setup new infrastructure
  // //////////////////////////////////

  // Setup DexRegistry
  const authorisedExchanges = Object.values(config.defi.paraswap.authorisedExchanges);
  const DexRegistrySetAuthorisedTx = await DexRegistryWrapper.contract.setAuthorised(
    authorisedExchanges, Array(authorisedExchanges.length).fill(true), { gasPrice },
  );
  await DexRegistryWrapper.verboseWaitForTransaction(DexRegistrySetAuthorisedTx, "Setting up DexRegistry");

  // //////////////////////////////////
  // Set contracts' managers
  // //////////////////////////////////

  for (const idx in config.backend.accounts) {
    const account = config.backend.accounts[idx];
    const WalletFactoryAddManagerTx = await WalletFactoryWrapper.contract.addManager(account, { gasPrice });
    await WalletFactoryWrapper.verboseWaitForTransaction(WalletFactoryAddManagerTx, `Set ${account} as the manager of the WalletFactory`);

    const TokenPriceRegistryAddManagerTx = await TokenPriceRegistryWrapper.contract.addManager(account, { gasPrice });
    await TokenPriceRegistryWrapper.verboseWaitForTransaction(TokenPriceRegistryAddManagerTx,
      `Set ${account} as the manager of the TokenPriceRegistry`);
  }

  // //////////////////////////////////
  // Set contracts' owners
  // //////////////////////////////////

  let changeOwnerTx = await WalletFactoryWrapper.contract.changeOwner(config.contracts.MultiSigWallet, { gasPrice });
  await WalletFactoryWrapper.verboseWaitForTransaction(changeOwnerTx, "Set the MultiSig as the owner of WalletFactory");

  changeOwnerTx = await TokenPriceRegistryWrapper.contract.changeOwner(config.contracts.MultiSigWallet, { gasPrice });
  await TokenPriceRegistryWrapper.verboseWaitForTransaction(changeOwnerTx, "Set the MultiSig as the owner of TokenPriceRegistryWrapper");

  changeOwnerTx = await VersionManagerWrapper.contract.changeOwner(config.contracts.MultiSigWallet, { gasPrice });
  await VersionManagerWrapper.verboseWaitForTransaction(changeOwnerTx, "Set the MultiSig as the owner of VersionManagerWrapper");

  changeOwnerTx = await DexRegistryWrapper.contract.changeOwner(config.contracts.MultiSigWallet, { gasPrice });
  await DexRegistryWrapper.verboseWaitForTransaction(changeOwnerTx, "Set the MultiSig as the owner of DexRegistryWrapper");

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////

  // TODO: change name from "module" to "feature" where appropriate
  configurator.updateModuleAddresses({
    LimitStorage: LimitStorageWrapper.contractAddress,
    TokenPriceRegistry: TokenPriceRegistryWrapper.contractAddress,
    LockStorage: LockStorageWrapper.contractAddress,
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

  configurator.updateInfrastructureAddresses({
    BaseWallet: BaseWalletWrapper.contractAddress,
    WalletFactory: WalletFactoryWrapper.contractAddress,
    DexRegistry: DexRegistryWrapper.contractAddress,
  });

  const gitHash = childProcess.execSync("git rev-parse HEAD").toString("utf8").replace(/\n$/, "");
  configurator.updateGitHash(gitHash);
  await configurator.save();

  await Promise.all([
    abiUploader.upload(VersionManagerWrapper, "modules"),
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
    abiUploader.upload(LimitStorageWrapper, "contracts"),
    abiUploader.upload(TokenPriceRegistryWrapper, "contracts"),
    abiUploader.upload(LockStorageWrapper, "contracts"),
    abiUploader.upload(BaseWalletWrapper, "contracts"),
    abiUploader.upload(WalletFactoryWrapper, "contracts"),
    abiUploader.upload(DexRegistryWrapper, "contracts"),
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

    const UpgraderWrapper = await deployer.deploy(
      Upgrader,
      {},
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

module.exports = {
  deploy,
};
