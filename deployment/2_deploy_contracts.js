/* global artifacts */
global.web3 = web3;

const GuardianStorage = artifacts.require("GuardianStorage");
const TransferStorage = artifacts.require("TransferStorage");

const BaseWallet = artifacts.require("BaseWallet");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const DappRegistry = artifacts.require("DappRegistry");
const MultiSig = artifacts.require("MultiSigWallet");
const ENS = artifacts.require("ENSRegistryWithFallback");
const ENSManager = artifacts.require("ArgentENSManager");
const ENSResolver = artifacts.require("ArgentENSResolver");
const WalletFactory = artifacts.require("WalletFactory");

const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const DexRegistry = artifacts.require("DexRegistry");

const utils = require("../utils/utilities.js");
const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  const { deploymentAccount, configurator, abiUploader } = await deployManager.getProps();
  const newConfig = configurator.config;
  const prevConfig = configurator.copyConfig();

  const walletRootEns = prevConfig.ENS.domain;

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
  // Deploy the MultiSig
  const MultiSigWrapper = await MultiSig.new(newConfig.multisig.threshold, newConfig.multisig.owners);

  // Deploy the new TokenPriceRegistry
  const TokenPriceRegistryWrapper = await TokenPriceRegistry.new();
  // Deploy the DexRegistry
  const DexRegistryWrapper = await DexRegistry.new();

  // Deploy Module Registry
  const ModuleRegistryWrapper = await ModuleRegistry.new();
  const DappRegistryWrapper = await DappRegistry.new(newConfig.settings.timelockPeriod);
  // Deploy the ENS Resolver
  const ENSResolverWrapper = await ENSResolver.new();
  // Deploy the ENS Manager
  const ENSManagerWrapper = await ENSManager.new(
    walletRootEns, utils.namehash(walletRootEns), newConfig.ENS.ensRegistry, ENSResolverWrapper.address);
  // Deploy the Wallet Factory
  const WalletFactoryWrapper = await WalletFactory.new(
    BaseWalletWrapper.address, GuardianStorageWrapper.address, prevConfig.backend.refundCollector);

  // /////////////////////////////////////////////////
  // Making ENSManager owner of the root wallet ENS
  // /////////////////////////////////////////////////

  const ENSRegistryWrapper = await ENS.at(newConfig.ENS.ensRegistry);

  // Get the address of the previous owner of the root wallet ENS (e.g. argent.xyz)
  const previousWalletEnsOwner = await ENSRegistryWrapper.owner(utils.namehash(walletRootEns));

  if (previousWalletEnsOwner.toLowerCase() === deploymentAccount.toLowerCase()) {
    // newly registered name -> change its owner from deploymentAccount to ENSManager address
    console.log("Replace deployment account by ENSManager as new owner of walletENS");
    await ENSRegistryWrapper.setOwner(utils.namehash(walletRootEns), ENSManagerWrapper.address);
  } else if (previousWalletEnsOwner.toLowerCase() === prevConfig.contracts.ENSManager.toLowerCase()) {
    // change the owner from the previous ENSManager.address to the new one
    console.log("change the owner from the previous ENSManager to the new one");
    const previousMultiSigWrapper = await MultiSig.at(prevConfig.contracts.MultiSigWallet);
    const previousENSManagerWrapper = await ENSManager.at(prevConfig.contracts.ENSManager);

    const multisigExecutor = new MultisigExecutor(previousMultiSigWrapper, deploymentAccount, prevConfig.multisig.autosign);
    console.log(`Owner of ${walletRootEns} changed from old ENSManager to new ENSManager...`);
    await multisigExecutor.executeCall(previousENSManagerWrapper, "changeRootnodeOwner", [ENSManagerWrapper.address]);
  } else {
    throw new Error(`Ownership of ${walletRootEns} not changed`);
  }

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////
  configurator.updateModuleAddresses({
    GuardianStorage: GuardianStorageWrapper.address,
    TransferStorage: TransferStorageWrapper.address,
    TokenPriceRegistry: TokenPriceRegistryWrapper.address,
  });

  configurator.updateInfrastructureAddresses({
    MultiSigWallet: MultiSigWrapper.address,
    WalletFactory: WalletFactoryWrapper.address,
    ENSResolver: ENSResolverWrapper.address,
    ENSManager: ENSManagerWrapper.address,
    ModuleRegistry: ModuleRegistryWrapper.address,
    DappRegistry: DappRegistryWrapper.address,
    DexRegistry: DexRegistryWrapper.address,
    BaseWallet: BaseWalletWrapper.address,
  });
  await configurator.save();

  await Promise.all([
    abiUploader.upload(GuardianStorageWrapper, "modules"),
    abiUploader.upload(TransferStorageWrapper, "modules"),
    abiUploader.upload(TokenPriceRegistryWrapper, "modules"),
    abiUploader.upload(MultiSigWrapper, "contracts"),
    abiUploader.upload(WalletFactoryWrapper, "contracts"),
    abiUploader.upload(ENSResolverWrapper, "contracts"),
    abiUploader.upload(ENSManagerWrapper, "contracts"),
    abiUploader.upload(ModuleRegistryWrapper, "contracts"),
    abiUploader.upload(DappRegistryWrapper, "contracts"),
    abiUploader.upload(DexRegistryWrapper, "contracts"),
    abiUploader.upload(BaseWalletWrapper, "contracts"),
  ]);

  console.log("## completed deployment script 2 ##");
}

// For truffle exec
module.exports = function (callback) {
  main().then(() => callback()).catch((err) => callback(err));
};
