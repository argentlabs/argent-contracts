/* global artifacts */
global.web3 = web3;

const GuardianStorage = artifacts.require("GuardianStorage");
const TransferStorage = artifacts.require("TransferStorage");
const LockStorage = artifacts.require("LockStorage");

const BaseWallet = artifacts.require("BaseWallet");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const Authoriser = artifacts.require("DappRegistry");
const CompoundRegistry = artifacts.require("CompoundRegistry");
const MultiSig = artifacts.require("MultiSigWallet");
const ENS = artifacts.require("ENSRegistryWithFallback");
const ENSManager = artifacts.require("ArgentENSManager");
const ENSResolver = artifacts.require("ArgentENSResolver");
const WalletFactory = artifacts.require("WalletFactory");

const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const DexRegistry = artifacts.require("DexRegistry");

const MakerRegistry = artifacts.require("MakerRegistry");
const ScdMcdMigration = artifacts.require("ScdMcdMigration");

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
  // Deploy the new LockStorage
  const LockStorageWrapper = await LockStorage.new();

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
  const AuthoriserWrapper = await Authoriser.new(newConfig.settings.securityPeriod);
  // Deploy Compound Registry
  const CompoundRegistryWrapper = await CompoundRegistry.new();
  // Deploy the ENS Resolver
  const ENSResolverWrapper = await ENSResolver.new();
  // Deploy the ENS Manager
  const ENSManagerWrapper = await ENSManager.new(
    walletRootEns, utils.namehash(walletRootEns), newConfig.ENS.ensRegistry, ENSResolverWrapper.address);
  // Deploy the Wallet Factory
  const WalletFactoryWrapper = await WalletFactory.new(
    BaseWalletWrapper.address, GuardianStorageWrapper.address, prevConfig.backend.refundCollector);

  // Deploy and configure Maker Registry
  const ScdMcdMigrationWrapper = await ScdMcdMigration.at(newConfig.defi.maker.migration);
  const vatAddress = await ScdMcdMigrationWrapper.vat();
  const MakerRegistryWrapper = await MakerRegistry.new(vatAddress);
  const wethJoinAddress = await ScdMcdMigrationWrapper.wethJoin();
  console.log(`Adding join adapter ${wethJoinAddress} to the MakerRegistry`);
  await MakerRegistryWrapper.addCollateral(wethJoinAddress);
  console.log("Set the MultiSig as the owner of the MakerRegistry");
  await MakerRegistryWrapper.changeOwner(newConfig.contracts.MultiSigWallet);

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
  // Add token to the Compound Registry
  // /////////////////////////////////////////////////

  for (const underlying in newConfig.defi.compound.markets) {
    const cToken = newConfig.defi.compound.markets[underlying];
    console.log(`Adding unerlying ${underlying} with cToken ${cToken} to the registry`);
    await CompoundRegistryWrapper.addCToken(underlying, cToken);
  }

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////
  configurator.updateModuleAddresses({
    GuardianStorage: GuardianStorageWrapper.address,
    TransferStorage: TransferStorageWrapper.address,
    LockStorage: LockStorageWrapper.address,
    TokenPriceRegistry: TokenPriceRegistryWrapper.address,
  });

  configurator.updateInfrastructureAddresses({
    MultiSigWallet: MultiSigWrapper.address,
    WalletFactory: WalletFactoryWrapper.address,
    ENSResolver: ENSResolverWrapper.address,
    ENSManager: ENSManagerWrapper.address,
    ModuleRegistry: ModuleRegistryWrapper.address,
    Authoriser: AuthoriserWrapper.address,
    CompoundRegistry: CompoundRegistryWrapper.address,
    DexRegistry: DexRegistryWrapper.address,
    BaseWallet: BaseWalletWrapper.address,
  });
  await configurator.save();

  await Promise.all([
    abiUploader.upload(GuardianStorageWrapper, "modules"),
    abiUploader.upload(TransferStorageWrapper, "modules"),
    abiUploader.upload(LockStorageWrapper, "modules"),
    abiUploader.upload(TokenPriceRegistryWrapper, "modules"),
    abiUploader.upload(MultiSigWrapper, "contracts"),
    abiUploader.upload(WalletFactoryWrapper, "contracts"),
    abiUploader.upload(ENSResolverWrapper, "contracts"),
    abiUploader.upload(ENSManagerWrapper, "contracts"),
    abiUploader.upload(ModuleRegistryWrapper, "contracts"),
    abiUploader.upload(AuthoriserWrapper, "contracts"),
    abiUploader.upload(CompoundRegistryWrapper, "contracts"),
    abiUploader.upload(DexRegistryWrapper, "contracts"),
    abiUploader.upload(BaseWalletWrapper, "contracts"),
  ]);

  console.log("## completed deployment script 2 ##");
}

// For truffle exec
module.exports = function (callback) {
  main().then(() => callback()).catch((err) => callback(err));
};
