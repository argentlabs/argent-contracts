const BaseWallet = require('../build/BaseWallet');
const ModuleRegistry = require('../build/ModuleRegistry');
const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const WalletFactory = require('../build/WalletFactory');
const GuardianStorage = require('../build/GuardianStorage');
const MultiSig = require('../build/MultiSigWallet');

const DeployManager = require('../utils/deploy-manager.js');
const MultisigExecutor = require('../utils/multisigexecutor.js');


const deploy = async (network) => {

    ////////////////////////////////////
    // Setup
    ////////////////////////////////////

    const manager = new DeployManager(network);
    await manager.setup();

    const configurator = manager.configurator;
    const deployer = manager.deployer;
    const deploymentWallet = deployer.signer;
    const abiUploader = manager.abiUploader;

    const config = configurator.config;
    console.log('Config:', config);

    const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
    const ENSResolverWrapper = await deployer.wrapDeployedContract(ENSResolver, config.contracts.ENSResolver);
    const ENSManagerWrapper = await deployer.wrapDeployedContract(ENSManager, config.contracts.ENSManager);
    const GuardianStorageWrapper = await deployer.wrapDeployedContract(GuardianStorage, config.modules.GuardianStorage);
    const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);

    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

    ////////////////////////////////////
    // Deploy contract
    ////////////////////////////////////

    // Deploy new BaseWallet
    const BaseWalletWrapper = await deployer.deploy(BaseWallet);

    // Deply Factory
    const WalletFactoryWrapper = await deployer.deploy(
        WalletFactory, {}, 
        config.ENS.ensRegistry, 
        ModuleRegistryWrapper.contractAddress, 
        BaseWalletWrapper.contractAddress, 
        ENSManagerWrapper.contractAddress, 
        ENSResolverWrapper.contractAddress,
        GuardianStorageWrapper.contractAddress);

    ///////////////////////////////////////////////////
    // Update config and Upload ABIs
    ///////////////////////////////////////////////////

    configurator.updateInfrastructureAddresses({
        WalletFactory: WalletFactoryWrapper.contractAddress,
        BaseWallet: BaseWalletWrapper.contractAddress
    });
    await configurator.save();

    await Promise.all([
        abiUploader.upload(WalletFactoryWrapper, "contracts"),
        abiUploader.upload(BaseWalletWrapper, "contracts")
    ]);

    ////////////////////////////////////
    // Set authorisations
    ////////////////////////////////////

    // Set the WalletFactory as a manager of ENSManager
    await multisigExecutor.executeCall(ENSManagerWrapper, "addManager", [WalletFactoryWrapper.contractAddress]);

    // Set the backend keys as managers for the WalletFactory
    for (idx in config.backend.accounts) {
        let account = config.backend.accounts[idx];
        const WalletFactoryAddManagerTx = await WalletFactoryWrapper.contract.addManager(account);
        await WalletFactoryWrapper.verboseWaitForTransaction(WalletFactoryAddManagerTx, `Set ${account} as the manager of the WalletFactory`);
    }

    // Set the multisig as the owner of the WalletFactory
    const changeOwnerTx = await WalletFactoryWrapper.contract.changeOwner(config.contracts.MultiSigWallet);
    await WalletFactoryWrapper.verboseWaitForTransaction(changeOwnerTx, `Set the MultiSig as the owner of the WalletFactory`);

}

module.exports = {
    deploy
};