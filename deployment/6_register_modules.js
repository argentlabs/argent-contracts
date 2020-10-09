const ModuleRegistry = require("../build/ModuleRegistry");
const MultiSig = require("../build/MultiSigWallet");

const GuardianManager = require("../build-legacy/v1.6.0/GuardianManager");
const TokenExchanger = require("../build-legacy/v1.6.0/TokenExchanger");
const LockManager = require("../build-legacy/v1.6.0/LockManager");
const RecoveryManager = require("../build-legacy/v1.6.0/RecoveryManager");
const ApprovedTransfer = require("../build-legacy/v1.6.0/ApprovedTransfer");
const TransferManager = require("../build-legacy/v1.6.0/TransferManager");
const NftTransfer = require("../build-legacy/v1.6.0/NftTransfer");
const CompoundManager = require("../build-legacy/v1.6.0/CompoundManager");
const MakerV2Manager = require("../build-legacy/v1.6.0/MakerV2Manager");

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

  const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
  const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);

  const wrappers = [
    GuardianManagerWrapper,
    LockManagerWrapper,
    RecoveryManagerWrapper,
    ApprovedTransferWrapper,
    TransferManagerWrapper,
    TokenExchangerWrapper,
    NftTransferWrapper,
    CompoundManagerWrapper,
    MakerV2ManagerWrapper,
  ];

  // //////////////////////////////////
  // Register modules
  // //////////////////////////////////

  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign, { gasPrice });

  for (let idx = 0; idx < wrappers.length; idx += 1) {
    const wrapper = wrappers[idx];
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule",
      [wrapper.contractAddress, utils.asciiToBytes32(wrapper._contract.contractName)]);
  }

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
