const GuardianStorage = artifacts.require("GuardianStorage");
const TransferStorage = artifacts.require("TransferStorage");
const LockStorage = artifacts.require("LockStorage");
const LimitStorage = artifacts.require("LimitStorage");

const BaseWallet = artifacts.require("BaseWallet");
const ModuleRegistry = artifacts.require("ModuleRegistry");
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
  const { abiUploader } = manager;
  const { gasPrice } = deployer.defaultOverrides;

  const newConfig = configurator.config;
  const prevConfig = configurator.copyConfig();
  console.log("Previous Config:", prevConfig);

  const deploymentWallet = deployer.signer;
  const deploymentAccount = await deploymentWallet.getAddress();
  const walletRootEns = prevConfig.ENS.domain;

  // //////////////////////////////////
  // Deploy Storage
  // //////////////////////////////////

  // Deploy the Guardian Storage
  const GuardianStorageWrapper = await deployer.deploy(GuardianStorage);
  // Deploy the Transfer Storage
  const TransferStorageWrapper = await deployer.deploy(TransferStorage);
  // Deploy the new LockStorage
  const LockStorageWrapper = await deployer.deploy(LockStorage);
  // Deploy the new LimitStorage
  const LimitStorageWrapper = await deployer.deploy(LimitStorage);

  // //////////////////////////////////
  // Deploy infrastructure contracts
  // //////////////////////////////////

  // Deploy the Base Wallet Library
  const BaseWalletWrapper = await deployer.deploy(BaseWallet);
  // Deploy the MultiSig
  const MultiSigWrapper = await deployer.deploy(MultiSig, {}, newConfig.multisig.threshold, newConfig.multisig.owners);

  // Deploy the new TokenPriceRegistry
  const TokenPriceRegistryWrapper = await deployer.deploy(TokenPriceRegistry);
  // Deploy the DexRegistry
  const DexRegistryWrapper = await deployer.deploy(DexRegistry);

  // Deploy Module Registry
  const ModuleRegistryWrapper = await deployer.deploy(ModuleRegistry);
  // Deploy Compound Registry
  const CompoundRegistryWrapper = await deployer.deploy(CompoundRegistry);
  // Deploy the ENS Resolver
  const ENSResolverWrapper = await deployer.deploy(ENSResolver);
  // Deploy the ENS Manager
  const ENSManagerWrapper = await deployer.deploy(ENSManager, {},
    walletRootEns, utils.namehash(walletRootEns), newConfig.ENS.ensRegistry, ENSResolverWrapper.address);
  // Deploy the Wallet Factory
  const WalletFactoryWrapper = await deployer.deploy(WalletFactory, {},
    ModuleRegistryWrapper.address, BaseWalletWrapper.address, GuardianStorageWrapper.address);

  // Deploy and configure Maker Registry
  const ScdMcdMigrationWrapper = await deployer.wrapDeployedContract(ScdMcdMigration, newConfig.defi.maker.migration);
  const vatAddress = await ScdMcdMigrationWrapper.vat();
  const MakerRegistryWrapper = await deployer.deploy(MakerRegistry, {}, vatAddress);
  const wethJoinAddress = await ScdMcdMigrationWrapper.wethJoin();
  const addCollateralTransaction = await MakerRegistryWrapper.contract.addCollateral(wethJoinAddress, { gasPrice });
  await MakerRegistryWrapper.verboseWaitForTransaction(addCollateralTransaction, `Adding join adapter ${wethJoinAddress} to the MakerRegistry`);
  const changeMakerRegistryOwnerTx = await MakerRegistryWrapper.contract.changeOwner(newConfig.contracts.MultiSigWallet, { gasPrice });
  await MakerRegistryWrapper.verboseWaitForTransaction(changeMakerRegistryOwnerTx, "Set the MultiSig as the owner of the MakerRegistry");

  // /////////////////////////////////////////////////
  // Making ENSManager owner of the root wallet ENS
  // /////////////////////////////////////////////////

  const ENSRegistryWrapper = deployer.wrapDeployedContract(ENS, newConfig.ENS.ensRegistry);

  // Get the address of the previous owner of the root wallet ENS (e.g. argent.xyz)
  const previousWalletEnsOwner = await ENSRegistryWrapper.contract.owner(utils.namehash(walletRootEns));

  if (previousWalletEnsOwner.toLowerCase() === deploymentAccount.toLowerCase()) {
    // newly registered name -> change its owner from deploymentAccount to ENSManager address
    const setOwnerTransaction = await ENSRegistryWrapper.contract.setOwner(utils.namehash(walletRootEns), ENSManagerWrapper.address,
      { gasPrice });
    await ENSRegistryWrapper.verboseWaitForTransaction(setOwnerTransaction, "Replace deployment account by ENSManager as new owner of walletENS");
  } else if (previousWalletEnsOwner.toLowerCase() === prevConfig.contracts.ENSManager.toLowerCase()) {
    // change the owner from the previous ENSManager.address to the new one
    console.log("change the owner from the previous ENSManager to the new one");
    const previousMultiSigWrapper = deployer.wrapDeployedContract(MultiSig, prevConfig.contracts.MultiSigWallet);
    const previousENSManagerWrapper = deployer.wrapDeployedContract(ENSManager, prevConfig.contracts.ENSManager);

    const multisigExecutor = new MultisigExecutor(previousMultiSigWrapper, deploymentWallet, prevConfig.multisig.autosign, { gasPrice });
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
    const addUnderlyingTransaction = await CompoundRegistryWrapper.contract.addCToken(underlying, cToken, { gasPrice });
    await CompoundRegistryWrapper.verboseWaitForTransaction(addUnderlyingTransaction,
      `Adding unerlying ${underlying} with cToken ${cToken} to the registry`);
  }

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////
  configurator.updateModuleAddresses({
    GuardianStorage: GuardianStorageWrapper.address,
    TransferStorage: TransferStorageWrapper.address,
    LockStorage: LockStorageWrapper.address,
    LimitStorage: LimitStorageWrapper.address,
    TokenPriceRegistry: TokenPriceRegistryWrapper.address,
  });

  configurator.updateInfrastructureAddresses({
    MultiSigWallet: MultiSigWrapper.address,
    WalletFactory: WalletFactoryWrapper.address,
    ENSResolver: ENSResolverWrapper.address,
    ENSManager: ENSManagerWrapper.address,
    ModuleRegistry: ModuleRegistryWrapper.address,
    CompoundRegistry: CompoundRegistryWrapper.address,
    DexRegistry: DexRegistryWrapper.address,
    BaseWallet: BaseWalletWrapper.address,
  });
  await configurator.save();

  await Promise.all([
    abiUploader.upload(GuardianStorageWrapper, "modules"),
    abiUploader.upload(TransferStorageWrapper, "modules"),
    abiUploader.upload(LockStorageWrapper, "modules"),
    abiUploader.upload(LimitStorageWrapper, "modules"),
    abiUploader.upload(TokenPriceRegistryWrapper, "modules"),
    abiUploader.upload(MultiSigWrapper, "contracts"),
    abiUploader.upload(WalletFactoryWrapper, "contracts"),
    abiUploader.upload(ENSResolverWrapper, "contracts"),
    abiUploader.upload(ENSManagerWrapper, "contracts"),
    abiUploader.upload(ModuleRegistryWrapper, "contracts"),
    abiUploader.upload(CompoundRegistryWrapper, "contracts"),
    abiUploader.upload(DexRegistryWrapper, "contracts"),
    abiUploader.upload(BaseWalletWrapper, "contracts"),
  ]);
};

module.exports = {
  deploy,
};
