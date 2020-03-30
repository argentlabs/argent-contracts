const BaseWallet = require('../build/BaseWallet');
const ModuleRegistry = require('../build/ModuleRegistry');
const CompoundRegistry = require('../build/CompoundRegistry');
const MultiSig = require('../build/MultiSigWallet');
const ENS = require('../build/ENSRegistryWithFallback');
const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const WalletFactory = require('../build/WalletFactory');
const TokenPriceProvider = require("../build/TokenPriceProvider");

const utils = require('../utils/utilities.js');

const DeployManager = require('../utils/deploy-manager.js');
const MultisigExecutor = require('../utils/multisigexecutor.js');

const deploy = async (network, secret) => {

    ////////////////////////////////////
    // Setup
    ////////////////////////////////////

    const manager = new DeployManager(network);
    await manager.setup();

    const configurator = manager.configurator;
    const deployer = manager.deployer;
    const abiUploader = manager.abiUploader;

    const newConfig = configurator.config;
    const prevConfig = configurator.copyConfig();
    console.log('Previous Config:', prevConfig);

    const deploymentWallet = deployer.signer;
    const deploymentAccount = await deploymentWallet.getAddress();
    const walletRootEns = prevConfig.ENS.domain;

    ////////////////////////////////////
    // Deploy contracts
    ////////////////////////////////////

    // Deploy the Base Wallet Library
    const BaseWalletWrapper = await deployer.deploy(BaseWallet);
    // Deploy the MultiSig
    const MultiSigWrapper = await deployer.deploy(MultiSig, {}, newConfig.multisig.threshold, newConfig.multisig.owners);
    // Deploy TokenPriceProvider
    const TokenPriceProviderWrapper = await deployer.deploy(TokenPriceProvider, {}, newConfig.Kyber.contract);
    // Deploy Module Registry
    const ModuleRegistryWrapper = await deployer.deploy(ModuleRegistry);
    // Deploy Compound Registry
    const CompoundRegistryWrapper = await deployer.deploy(CompoundRegistry);
    // Deploy the ENS Resolver
    const ENSResolverWrapper = await deployer.deploy(ENSResolver);
    // Deploy the ENS Manager
    const ENSManagerWrapper = await deployer.deploy(ENSManager, {}, walletRootEns, utils.namehash(walletRootEns), newConfig.ENS.ensRegistry, ENSResolverWrapper.contractAddress);
    // Deploy the Wallet Factory
    const WalletFactoryWrapper = await deployer.deploy(WalletFactory, {}, ModuleRegistryWrapper.contractAddress, BaseWalletWrapper.contractAddress, ENSManagerWrapper.contractAddress);

    ///////////////////////////////////////////////////
    // Making ENSManager owner of the root wallet ENS
    ///////////////////////////////////////////////////

    const ENSRegistryWrapper = deployer.wrapDeployedContract(ENS, newConfig.ENS.ensRegistry);

    // Get the address of the previous owner of the root wallet ENS (e.g. argent.xyz)
    const previousWalletEnsOwner = await ENSRegistryWrapper.contract.owner(utils.namehash(walletRootEns));

    if (previousWalletEnsOwner.toLowerCase() === deploymentAccount.toLowerCase()) {
        // newly registered name -> change its owner from deploymentAccount to ENSManager address
        const setOwnerTransaction = await ENSRegistryWrapper.contract.setOwner(utils.namehash(walletRootEns), ENSManagerWrapper.contractAddress);
        await ENSRegistryWrapper.verboseWaitForTransaction(setOwnerTransaction, 'Replace deployment account by ENSManager as new owner of walletENS');
    } else if (previousWalletEnsOwner.toLowerCase() === prevConfig.contracts.ENSManager.toLowerCase()) {
        // change the owner from the previous ENSManager.address to the new one
        console.log('change the owner from the previous ENSManager to the new one');
        const previousMultiSigWrapper = deployer.wrapDeployedContract(MultiSig, prevConfig.contracts.MultiSigWallet);
        const previousENSManagerWrapper = deployer.wrapDeployedContract(ENSManager, prevConfig.contracts.ENSManager);

        const multisigExecutor = new MultisigExecutor(previousMultiSigWrapper, deploymentWallet, prevConfig.multisig.autosign);
        console.log(`Owner of ${walletRootEns} changed from old ENSManager to new ENSManager...`)
        await multisigExecutor.executeCall(previousENSManagerWrapper, "changeRootnodeOwner", [ENSManagerWrapper.contractAddress]);
    } else {
        throw new Error(`Ownership of ${walletRootEns} not changed`);
    }

    ///////////////////////////////////////////////////
    // Add token to the Compound Registry
    ///////////////////////////////////////////////////
    
    for (let underlying in newConfig.defi.compound.markets) {
        const cToken = newConfig.defi.compound.markets[underlying];
        const addUnderlyingTransaction = await CompoundRegistryWrapper.addCToken(underlying, cToken);
        await CompoundRegistryWrapper.verboseWaitForTransaction(addUnderlyingTransaction, `Adding unerlying ${underlying} with cToken ${cToken} to the registry`);
    }

    ///////////////////////////////////////////////////
    // Update config and Upload ABIs
    ///////////////////////////////////////////////////

    configurator.updateInfrastructureAddresses({
        MultiSigWallet: MultiSigWrapper.contractAddress,
        WalletFactory: WalletFactoryWrapper.contractAddress,
        ENSResolver: ENSResolverWrapper.contractAddress,
        ENSManager: ENSManagerWrapper.contractAddress,
        TokenPriceProvider: TokenPriceProviderWrapper.contractAddress,
        ModuleRegistry: ModuleRegistryWrapper.contractAddress,
        CompoundRegistry: CompoundRegistryWrapper.contractAddress,
        BaseWallet: BaseWalletWrapper.contractAddress
    });
    await configurator.save();

    await Promise.all([
        abiUploader.upload(MultiSigWrapper, "contracts"),
        abiUploader.upload(WalletFactoryWrapper, "contracts"),
        abiUploader.upload(ENSResolverWrapper, "contracts"),
        abiUploader.upload(ENSManagerWrapper, "contracts"),
        abiUploader.upload(TokenPriceProviderWrapper, "contracts"),
        abiUploader.upload(ModuleRegistryWrapper, "contracts"),
        abiUploader.upload(CompoundRegistryWrapper, "contracts"),
        abiUploader.upload(BaseWalletWrapper, "contracts")
    ]);
};

module.exports = {
    deploy
};