const childProcess = require("child_process");

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
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    VersionManagerWrapper.contractAddress,
    config.settings.securityPeriod || 0,
    config.settings.securityWindow || 0,
  );
  // Deploy the LockManager module
  const LockManagerWrapper = await deployer.deploy(
    LockManager,
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    VersionManagerWrapper.contractAddress,
    config.settings.lockPeriod || 0,
  );
  // Deploy the RecoveryManager module
  const RecoveryManagerWrapper = await deployer.deploy(
    RecoveryManager,
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    VersionManagerWrapper.contractAddress,
    config.settings.recoveryPeriod || 0,
    config.settings.lockPeriod || 0,
  );
  // Deploy the ApprovedTransfer module
  const ApprovedTransferWrapper = await deployer.deploy(
    ApprovedTransfer,
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    config.modules.LimitStorage,
    VersionManagerWrapper.contractAddress,
    config.defi.weth,
  );
  // Deploy the TransferManager module
  const TransferManagerWrapper = await deployer.deploy(
    TransferManager,
    {},
    config.modules.LockStorage,
    config.modules.TransferStorage,
    config.modules.LimitStorage,
    config.contracts.TokenPriceRegistry,
    VersionManagerWrapper.contractAddress,
    config.settings.securityPeriod || 0,
    config.settings.securityWindow || 0,
    config.settings.defaultLimit || "1000000000000000000",
    config.defi.weth,
    ["test", "staging", "prod"].includes(network) ? config.modules.TransferManager : "0x0000000000000000000000000000000000000000",
  );
  // Deploy the TokenExchanger module
  const TokenExchangerWrapper = await deployer.deploy(
    TokenExchanger,
    {},
    config.modules.LockStorage,
    config.contracts.TokenPriceRegistry,
    VersionManagerWrapper.contractAddress,
    config.contracts.DexRegistry,
    config.defi.paraswap.contract,
    "argent",
  );
  // Deploy the NFTTransfer module
  const NftTransferWrapper = await deployer.deploy(
    NftTransfer,
    {},
    config.modules.LockStorage,
    config.contracts.TokenPriceRegistry,
    VersionManagerWrapper.contractAddress,
    config.CryptoKitties.contract,
  );
  // Deploy the CompoundManager module
  const CompoundManagerWrapper = await deployer.deploy(
    CompoundManager,
    {},
    config.modules.LockStorage,
    config.defi.compound.comptroller,
    config.contracts.CompoundRegistry,
    VersionManagerWrapper.contractAddress,
  );
  // Deploy MakerManagerV2
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
  // Deploy RelayerManager
  const RelayerManagerWrapper = await deployer.deploy(
    RelayerManager,
    {},
    config.modules.LockStorage,
    config.modules.GuardianStorage,
    config.modules.LimitStorage,
    config.contracts.TokenPriceRegistry,
    VersionManagerWrapper.contractAddress,
  );

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////

  // TODO: change name from "module" to "feature" where appropriate
  configurator.updateModuleAddresses({
    GuardianManager: GuardianManagerWrapper.contractAddress,
    LockManager: LockManagerWrapper.contractAddress,
    RecoveryManager: RecoveryManagerWrapper.contractAddress,
    ApprovedTransfer: ApprovedTransferWrapper.contractAddress,
    TransferManager: TransferManagerWrapper.contractAddress,
    TokenExchanger: TokenExchangerWrapper.contractAddress,
    NftTransfer: NftTransferWrapper.contractAddress,
    CompoundManager: CompoundManagerWrapper.contractAddress,
    MakerV2Manager: MakerV2ManagerWrapper.contractAddress,
    RelayerManager: RelayerManagerWrapper.contractAddress,
    VersionManager: VersionManagerWrapper.contractAddress,
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
