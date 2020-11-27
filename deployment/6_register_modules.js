/* global artifacts */

global.web3 = web3;

const ModuleRegistry = artifacts.require("ModuleRegistry");
const MultiSig = artifacts.require("MultiSigWallet");

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

const utils = require("../utils/utilities.js");
const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  const { deploymentAccount, configurator, versionUploader } = await deployManager.getProps();
  const { config } = configurator;

  const GuardianManagerWrapper = await GuardianManager.at(config.modules.GuardianManager);
  const LockManagerWrapper = await LockManager.at(config.modules.LockManager);
  const RecoveryManagerWrapper = await RecoveryManager.at(config.modules.RecoveryManager);
  const ApprovedTransferWrapper = await ApprovedTransfer.at(config.modules.ApprovedTransfer);
  const TransferManagerWrapper = await TransferManager.at(config.modules.TransferManager);
  const TokenExchangerWrapper = await TokenExchanger.at(config.modules.TokenExchanger);
  const NftTransferWrapper = await NftTransfer.at(config.modules.NftTransfer);
  const CompoundManagerWrapper = await CompoundManager.at(config.modules.CompoundManager);
  const MakerV2ManagerWrapper = await MakerV2Manager.at(config.modules.MakerV2Manager);
  const RelayerManagerWrapper = await RelayerManager.at(config.modules.RelayerManager);
  const VersionManagerWrapper = await VersionManager.at(config.modules.VersionManager);

  const ModuleRegistryWrapper = await ModuleRegistry.at(config.contracts.ModuleRegistry);
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);

  const wrappers = [VersionManagerWrapper];

  // Add Features to Version Manager
  const features = [
    GuardianManagerWrapper.address,
    LockManagerWrapper.address,
    RecoveryManagerWrapper.address,
    ApprovedTransferWrapper.address,
    TransferManagerWrapper.address,
    TokenExchangerWrapper.address,
    NftTransferWrapper.address,
    CompoundManagerWrapper.address,
    MakerV2ManagerWrapper.address,
    RelayerManagerWrapper.address,
  ];
  const featuresWithNoInit = [ // all features except the TransferManager
    GuardianManagerWrapper.address,
    LockManagerWrapper.address,
    RecoveryManagerWrapper.address,
    ApprovedTransferWrapper.address,
    TokenExchangerWrapper.address,
    NftTransferWrapper.address,
    CompoundManagerWrapper.address,
    MakerV2ManagerWrapper.address,
    RelayerManagerWrapper.address,
  ];
  const featureToInit = features.filter((f) => !featuresWithNoInit.includes(f));
  console.log("Adding New Version");
  await VersionManagerWrapper.addVersion(features, featureToInit);

  // //////////////////////////////////
  // Register and configure VersionManager
  // //////////////////////////////////

  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  for (let idx = 0; idx < wrappers.length; idx += 1) {
    const wrapper = wrappers[idx];
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule",
      [wrapper.address, utils.asciiToBytes32(wrapper.constructor.contractName)]);
  }

  console.log("Set the MultiSig as the owner of VersionManagerWrapper");
  await VersionManagerWrapper.changeOwner(config.contracts.MultiSigWallet);

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
