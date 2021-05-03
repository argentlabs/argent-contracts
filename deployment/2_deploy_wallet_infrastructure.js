/* global artifacts */
global.web3 = web3;
global.artifacts = artifacts;

const ethers = require("ethers");

const GuardianStorage = artifacts.require("GuardianStorage");
const TransferStorage = artifacts.require("TransferStorage");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const MultiSig = artifacts.require("MultiSigWallet");
const ENS = artifacts.require("ENSRegistryWithFallback");
const ENSManager = artifacts.require("ArgentENSManager");
const ENSResolver = artifacts.require("ArgentENSResolver");
const WalletFactory = artifacts.require("WalletFactory");
const ArgentWalletDetector = artifacts.require("ArgentWalletDetector");

const utils = require("../utils/utilities.js");
const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  const { deploymentAccount, configurator, abiUploader } = await deployManager.getProps();
  const config = configurator.config;

  const walletRootEns = config.ENS.domain;

  // //////////////////////////////////
  // Deploy Storage
  // //////////////////////////////////

  // Deploy the Guardian Storage
  const GuardianStorageWrapper = await GuardianStorage.new();
  // Deploy the Transfer Storage
  const TransferStorageWrapper = await TransferStorage.new();

  // //////////////////////////////////
  // Deploy infrastructure contracts
  // //////////////////////////////////

  // Deploy the Base Wallet Library
  const BaseWalletWrapper = await BaseWallet.new();
  console.log("Deployed BaseWallet at ", BaseWalletWrapper.address);
  // Deploy the MultiSig
  const MultiSigWrapper = await MultiSig.new(config.multisig.threshold, config.multisig.owners);
  console.log("Deployed MultiSig at ", MultiSigWrapper.address);
  // Deploy Module Registry
  const ModuleRegistryWrapper = await ModuleRegistry.new();
  console.log("Deployed ModuleRegistry at ", ModuleRegistryWrapper.address);
  // Deploy the ENS Resolver
  const ENSResolverWrapper = await ENSResolver.new();
  console.log("Deployed ENSResolver at ", ENSResolverWrapper.address);
  // Deploy the ENS Manager
  const ENSManagerWrapper = await ENSManager.new(
    walletRootEns, utils.namehash(walletRootEns), config.ENS.ensRegistry, ENSResolverWrapper.address);
  console.log("Deployed ENSManager at ", ENSManagerWrapper.address);
  // Deploy the Wallet Factory
  const WalletFactoryWrapper = await WalletFactory.new(
    BaseWalletWrapper.address, GuardianStorageWrapper.address, config.backend.refundCollector);
  console.log("Deployed WalletFactory at ", WalletFactoryWrapper.address);
  // Deploy ArgentWalletDetector contract
  const ArgentWalletDetectorWrapper = await ArgentWalletDetector.new([], []);
  console.log("Deployed ArgentWalletDetector at ", ArgentWalletDetectorWrapper.address);

  // /////////////////////////////////////////////////
  // Making ENSManager owner of the root wallet ENS
  // /////////////////////////////////////////////////

  const ENSRegistryWrapper = await ENS.at(config.ENS.ensRegistry);

  // Get the address of the previous owner of the root wallet ENS (e.g. argent.xyz)
  const previousWalletEnsOwner = await ENSRegistryWrapper.owner(utils.namehash(walletRootEns));

  if (previousWalletEnsOwner.toLowerCase() === deploymentAccount.toLowerCase()) {
    // newly registered name -> change its owner from deploymentAccount to ENSManager address
    console.log("Replace deployment account by ENSManager as new owner of walletENS");
    await ENSRegistryWrapper.setOwner(utils.namehash(walletRootEns), ENSManagerWrapper.address);
  } else if (previousWalletEnsOwner.toLowerCase() === config.contracts.ENSManager.toLowerCase()) {
    // change the owner from the previous ENSManager.address to the new one
    console.log("change the owner from the previous ENSManager to the new one");
    const previousMultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
    const previousENSManagerWrapper = await ENSManager.at(config.contracts.ENSManager);

    const multisigExecutor = new MultisigExecutor(previousMultiSigWrapper, deploymentAccount, config.multisig.autosign);
    console.log(`Owner of ${walletRootEns} changed from old ENSManager to new ENSManager...`);
    await multisigExecutor.executeCall(previousENSManagerWrapper, "changeRootnodeOwner", [ENSManagerWrapper.address]);
  } else {
    throw new Error(`Ownership of ${walletRootEns} not changed`);
  }

  // //////////////////////////////////
  // Add new wallet to ArgentWalletDetector
  // //////////////////////////////////

  console.log("Adding wallet code to detector");
  const proxyCode = ethers.utils.keccak256(Proxy.deployedBytecode);
  await ArgentWalletDetectorWrapper.addCode(proxyCode);
  console.log("Adding wallet implementation to detector");
  await ArgentWalletDetectorWrapper.addImplementation(BaseWalletWrapper.address);

  // //////////////////////////////////
  // Set contracts' managers
  // //////////////////////////////////

  console.log("Set the ENS Manager as the manager of the ENS Resolver");
  await ENSResolverWrapper.addManager(ENSManagerWrapper.address);

  console.log("Set the Multisig as the manager of the ENS Resolver");
  await ENSResolverWrapper.addManager(MultiSigWrapper.address);

  for (const idx in config.backend.accounts) {
    const account = config.backend.accounts[idx];
    console.log(`Set ${account} as the manager of the WalletFactory`);
    await WalletFactoryWrapper.addManager(account);
  }

  // //////////////////////////////////
  // Set contracts' owners
  // //////////////////////////////////

  const wrappers = [
    ENSResolverWrapper,
    ENSManagerWrapper,
    WalletFactoryWrapper,
    ModuleRegistryWrapper,
    ArgentWalletDetectorWrapper];

  for (let idx = 0; idx < wrappers.length; idx += 1) {
    const wrapper = wrappers[idx];
    console.log(`Set the MultiSig as the owner of ${wrapper.constructor.contractName}`);
    await wrapper.changeOwner(MultiSigWrapper.address);
  }

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////
  configurator.updateModuleAddresses({
    GuardianStorage: GuardianStorageWrapper.address,
    TransferStorage: TransferStorageWrapper.address,
  });

  configurator.updateInfrastructureAddresses({
    MultiSigWallet: MultiSigWrapper.address,
    WalletFactory: WalletFactoryWrapper.address,
    ArgentWalletDetector: ArgentWalletDetectorWrapper.address,
    ENSResolver: ENSResolverWrapper.address,
    ENSManager: ENSManagerWrapper.address,
    ModuleRegistry: ModuleRegistryWrapper.address,
    BaseWallet: BaseWalletWrapper.address,
  });
  await configurator.save();

  await Promise.all([
    abiUploader.upload(GuardianStorageWrapper, "modules"),
    abiUploader.upload(TransferStorageWrapper, "modules"),
    abiUploader.upload(MultiSigWrapper, "contracts"),
    abiUploader.upload(WalletFactoryWrapper, "contracts"),
    abiUploader.upload(ArgentWalletDetectorWrapper, "contracts"),
    abiUploader.upload(ENSResolverWrapper, "contracts"),
    abiUploader.upload(ENSManagerWrapper, "contracts"),
    abiUploader.upload(ModuleRegistryWrapper, "contracts"),
    abiUploader.upload(BaseWalletWrapper, "contracts"),
  ]);

  console.log("## completed deployment script 2 ##");
}

// For truffle exec
module.exports = function (callback) {
  main().then(() => callback()).catch((err) => callback(err));
};
