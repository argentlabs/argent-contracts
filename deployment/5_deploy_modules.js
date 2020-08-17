const childProcess = require("child_process");

const ApprovedTransfer = artifacts.require("ApprovedTransfer");
const CompoundManager = artifacts.require("CompoundManager");
const GuardianManager = artifacts.require("GuardianManager");
const LockManager = artifacts.require("LockManager");
const NftTransfer = artifacts.require("NftTransfer");
const RecoveryManager = artifacts.require("RecoveryManager");
const TokenExchanger = artifacts.require("TokenExchanger");
const MakerV2Manager = artifacts.require("MakerV2Manager");
const TransferManager = artifacts.require("TransferManager");
const RelayerManager = artifacts.require("RelayerManager");
const VersionManager = artifacts.require("VersionManager");

const DeployManager = require("../utils/deploy-manager.js");

// ///////////////////////////////////////////////////////
//                 Version 2.1
// ///////////////////////////////////////////////////////

const deploy = async (network) => {
  // //////////////////////////////////
  // Setup
  // //////////////////////////////////

  const manager = new DeployManager(network);
  await manager.setup();

  const { configurator } = manager;
  const { deployer } = manager;
  const { abiUploader } = manager;

  const { config } = configurator;
  console.log(config);

  // //////////////////////////////////
  // Deploy VersionManager module
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

  // //////////////////////////////////
  // Deploy features
  // //////////////////////////////////

  // Deploy the GuardianManager module
  const GuardianManagerWrapper = await deployer.deploy(
    GuardianManager,
<<<<<<< HEAD
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    VersionManagerWrapper.address,
=======
    config.contracts.ModuleRegistry,
    GuardianStorageWrapper.address,
>>>>>>> b79932ef... Migrate away from deployer.deploy syntax and to .new()
    config.settings.securityPeriod || 0,
    config.settings.securityWindow || 0,
  );
  // Deploy the LockManager module
  const LockManagerWrapper = await deployer.deploy(
    LockManager,
<<<<<<< HEAD
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    VersionManagerWrapper.address,
=======
    config.contracts.ModuleRegistry,
    GuardianStorageWrapper.address,
>>>>>>> b79932ef... Migrate away from deployer.deploy syntax and to .new()
    config.settings.lockPeriod || 0,
  );
  // Deploy the RecoveryManager module
  const RecoveryManagerWrapper = await deployer.deploy(
    RecoveryManager,
<<<<<<< HEAD
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    VersionManagerWrapper.address,
=======
    config.contracts.ModuleRegistry,
    GuardianStorageWrapper.address,
>>>>>>> b79932ef... Migrate away from deployer.deploy syntax and to .new()
    config.settings.recoveryPeriod || 0,
    config.settings.lockPeriod || 0,
  );
  // Deploy the ApprovedTransfer module
  const ApprovedTransferWrapper = await deployer.deploy(
    ApprovedTransfer,
<<<<<<< HEAD
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    config.modules.LimitStorage,
    VersionManagerWrapper.address,
    config.defi.weth,
=======
    config.contracts.ModuleRegistry,
    GuardianStorageWrapper.address,
>>>>>>> b79932ef... Migrate away from deployer.deploy syntax and to .new()
  );
  // Deploy the TransferManager module
  const TransferManagerWrapper = await deployer.deploy(
    TransferManager,
<<<<<<< HEAD
    {},
    config.modules.LockStorage,
    config.modules.TransferStorage,
    config.modules.LimitStorage,
    config.modules.TokenPriceRegistry,
    VersionManagerWrapper.address,
=======
    config.contracts.ModuleRegistry,
    TransferStorageWrapper.address,
    GuardianStorageWrapper.address,
    config.contracts.TokenPriceProvider,
>>>>>>> b79932ef... Migrate away from deployer.deploy syntax and to .new()
    config.settings.securityPeriod || 0,
    config.settings.securityWindow || 0,
    config.settings.defaultLimit || "1000000000000000000",
    config.defi.weth,
    ["test", "staging", "prod"].includes(network) ? config.modules.TransferManager : "0x0000000000000000000000000000000000000000",
  );
  // Deploy the TokenExchanger module
  const TokenExchangerWrapper = await deployer.deploy(
    TokenExchanger,
<<<<<<< HEAD
    {},
    config.modules.LockStorage,
    config.modules.TokenPriceRegistry,
    VersionManagerWrapper.address,
    config.contracts.DexRegistry,
    config.defi.paraswap.contract,
    "argent",
=======
    config.contracts.ModuleRegistry,
    GuardianStorageWrapper.address,
    config.Kyber ? config.Kyber.contract : "0x0000000000000000000000000000000000000000",
    config.contracts.MultiSigWallet,
    config.settings.feeRatio || 0,
>>>>>>> b79932ef... Migrate away from deployer.deploy syntax and to .new()
  );
  // Deploy the NFTTransfer module
  const NftTransferWrapper = await deployer.deploy(
    NftTransfer,
<<<<<<< HEAD
    {},
    config.modules.LockStorage,
    config.modules.TokenPriceRegistry,
    VersionManagerWrapper.address,
=======
    config.contracts.ModuleRegistry,
    GuardianStorageWrapper.address,
>>>>>>> b79932ef... Migrate away from deployer.deploy syntax and to .new()
    config.CryptoKitties.contract,
  );
  // Deploy the CompoundManager module
  const CompoundManagerWrapper = await deployer.deploy(
    CompoundManager,
<<<<<<< HEAD
    {},
    config.modules.LockStorage,
=======
    config.contracts.ModuleRegistry,
    GuardianStorageWrapper.address,
>>>>>>> b79932ef... Migrate away from deployer.deploy syntax and to .new()
    config.defi.compound.comptroller,
    config.contracts.CompoundRegistry,
    VersionManagerWrapper.address,
  );
  // Deploy MakerManagerV2
  const MakerV2ManagerWrapper = await deployer.deploy(
    MakerV2Manager,
<<<<<<< HEAD
    {},
    config.modules.LockStorage,
=======
    config.contracts.ModuleRegistry,
    GuardianStorageWrapper.address,
>>>>>>> b79932ef... Migrate away from deployer.deploy syntax and to .new()
    config.defi.maker.migration,
    config.defi.maker.pot,
    config.defi.maker.jug,
    config.contracts.MakerRegistry,
    config.defi.uniswap.factory,
    VersionManagerWrapper.address,
  );
  // Deploy RelayerManager
  const RelayerManagerWrapper = await deployer.deploy(
    RelayerManager,
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    config.modules.LimitStorage,
    config.modules.TokenPriceRegistry,
    VersionManagerWrapper.address,
  );

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////

  // TODO: change name from "module" to "feature" where appropriate
  configurator.updateModuleAddresses({
    GuardianManager: GuardianManagerWrapper.address,
    LockManager: LockManagerWrapper.address,
    RecoveryManager: RecoveryManagerWrapper.address,
    ApprovedTransfer: ApprovedTransferWrapper.address,
    TransferManager: TransferManagerWrapper.address,
    TokenExchanger: TokenExchangerWrapper.address,
    NftTransfer: NftTransferWrapper.address,
    CompoundManager: CompoundManagerWrapper.address,
    MakerV2Manager: MakerV2ManagerWrapper.address,
    RelayerManager: RelayerManagerWrapper.address,
    VersionManager: VersionManagerWrapper.address,
  });

  const gitHash = childProcess.execSync("git rev-parse HEAD").toString("utf8").replace(/\n$/, "");
  configurator.updateGitHash(gitHash);

  await configurator.save();

  await Promise.all([
    abiUploader.upload(GuardianManagerWrapper, "modules"),
    abiUploader.upload(LockManagerWrapper, "modules"),
    abiUploader.upload(RecoveryManagerWrapper, "modules"),
    abiUploader.upload(ApprovedTransferWrapper, "modules"),
    abiUploader.upload(TransferManagerWrapper, "modules"),
    abiUploader.upload(TokenExchangerWrapper, "modules"),
    abiUploader.upload(NftTransferWrapper, "modules"),
    abiUploader.upload(MakerV2ManagerWrapper, "modules"),
    abiUploader.upload(CompoundManagerWrapper, "modules"),
    abiUploader.upload(RelayerManagerWrapper, "modules"),
    abiUploader.upload(VersionManagerWrapper, "modules"),
  ]);

  console.log("Config:", config);
};

module.exports = {
  deploy,
};
