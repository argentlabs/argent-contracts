/* global artifacts */

const ModuleRegistry = artifacts.require("ModuleRegistry");
const MultiSig = artifacts.require("MultiSigWallet");

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

const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const deploy = async (network) => {
  // //////////////////////////////////
  // Setup
  // //////////////////////////////////

  const manager = new DeployManager(network);
  await manager.setup();

  const { configurator } = manager;
  const { deployer } = manager;
  const { versionUploader } = manager;
  const { gasPrice } = deployer.defaultOverrides;

  const deploymentWallet = deployer.signer;

  const { config } = configurator;
  console.log("Config:", config);

  const GuardianManagerWrapper = await deployer.wrapDeployedContract(GuardianManager, config.modules.GuardianManager);
  const LockManagerWrapper = await deployer.wrapDeployedContract(LockManager, config.modules.LockManager);
  const RecoveryManagerWrapper = await deployer.wrapDeployedContract(RecoveryManager, config.modules.RecoveryManager);
  const ApprovedTransferWrapper = await deployer.wrapDeployedContract(ApprovedTransfer, config.modules.ApprovedTransfer);
  const TransferManagerWrapper = await deployer.wrapDeployedContract(TransferManager, config.modules.TransferManager);
  const TokenExchangerWrapper = await deployer.wrapDeployedContract(TokenExchanger, config.modules.TokenExchanger);
  const NftTransferWrapper = await deployer.wrapDeployedContract(NftTransfer, config.modules.NftTransfer);
  const CompoundManagerWrapper = await deployer.wrapDeployedContract(CompoundManager, config.modules.CompoundManager);
  const MakerV2ManagerWrapper = await deployer.wrapDeployedContract(MakerV2Manager, config.modules.MakerV2Manager);
  const RelayerManagerWrapper = await deployer.wrapDeployedContract(RelayerManager, config.modules.RelayerManager);
  const VersionManagerWrapper = await deployer.wrapDeployedContract(VersionManager, config.modules.VersionManager);

  const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
  const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);

  const wrappers = [VersionManagerWrapper];

  // Add Features to Version Manager
  const features = [
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
  const featuresWithNoInit = [ // all features except the TransferManager
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
  const featureToInit = features.filter((f) => !featuresWithNoInit.includes(f));
  const VersionManagerAddVersionTx = await VersionManagerWrapper.contract.addVersion(features, featureToInit, { gasPrice });
  await VersionManagerWrapper.verboseWaitForTransaction(VersionManagerAddVersionTx, "Adding New Version");

  // //////////////////////////////////
  // Register and configure VersionManager
  // //////////////////////////////////

  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign, { gasPrice });

  for (let idx = 0; idx < wrappers.length; idx += 1) {
    const wrapper = wrappers[idx];
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule",
      [wrapper.contractAddress, utils.asciiToBytes32(wrapper._contract.contractName)]);
  }

  const changeOwnerTx = await VersionManagerWrapper.contract.changeOwner(config.contracts.MultiSigWallet, { gasPrice });
  await VersionManagerWrapper.verboseWaitForTransaction(changeOwnerTx, "Set the MultiSig as the owner of VersionManagerWrapper");

  // //////////////////////////////////
  // Upload Version
  // //////////////////////////////////

  const modules = wrappers.map((wrapper) => ({ address: wrapper.contractAddress, name: wrapper._contract.contractName }));
  const version = {
    modules,
    fingerprint: utils.versionFingerprint(modules),
    version: "1.0.0",
    createdAt: Math.floor((new Date()).getTime() / 1000),
  };
  await versionUploader.upload(version);
};

module.exports = {
  deploy,
};
