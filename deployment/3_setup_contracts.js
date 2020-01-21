const ModuleRegistry = require('../build/ModuleRegistry');
const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const WalletFactory = require('../build/WalletFactory');
const TokenPriceProvider = require('../build/TokenPriceProvider');
const CompoundRegistry = require('../build/CompoundRegistry');

const DeployManager = require('../utils/deploy-manager.js');

const deploy = async (network, secret) => {

    ////////////////////////////////////
    // Setup
    ////////////////////////////////////

    const manager = new DeployManager(network);
    await manager.setup();

    const configurator = manager.configurator;
    const deployer = manager.deployer;

    const config = configurator.config;
    console.log('Config:', config);

    const ENSResolverWrapper = await deployer.wrapDeployedContract(ENSResolver, config.contracts.ENSResolver);
    const ENSManagerWrapper = await deployer.wrapDeployedContract(ENSManager, config.contracts.ENSManager);
    const WalletFactoryWrapper = await deployer.wrapDeployedContract(WalletFactory, config.contracts.WalletFactory);
    const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
    const CompoundRegistryWrapper = await deployer.wrapDeployedContract(CompoundRegistry, config.contracts.CompoundRegistry);
    const TokenPriceProviderWrapper = await deployer.wrapDeployedContract(TokenPriceProvider, config.contracts.TokenPriceProvider);

    ////////////////////////////////////
    // Set contracts' managers
    ////////////////////////////////////

    const ENSResolverAddManagerTx1 = await ENSResolverWrapper.contract.addManager(config.contracts.ENSManager);
    await ENSResolverWrapper.verboseWaitForTransaction(ENSResolverAddManagerTx1, 'Set the ENS Manager as the manager of the ENS Resolver');

    const ENSResolverAddManagerTx2 = await ENSResolverWrapper.contract.addManager(config.contracts.MultiSigWallet);
    await ENSResolverWrapper.verboseWaitForTransaction(ENSResolverAddManagerTx2, 'Set the Multisig as the manager of the ENS Resolver');

    const ENSManagerAddManagerTx = await ENSManagerWrapper.contract.addManager(config.contracts.WalletFactory);
    await ENSManagerWrapper.verboseWaitForTransaction(ENSManagerAddManagerTx, 'Set the WalletFactory as the manager of the ENS Manager');

    for (idx in config.backend.accounts) {
        let account = config.backend.accounts[idx];
        const WalletFactoryAddManagerTx = await WalletFactoryWrapper.contract.addManager(account);
        await WalletFactoryWrapper.verboseWaitForTransaction(WalletFactoryAddManagerTx, `Set ${account} as the manager of the WalletFactory`);

        const TokenPriceProviderAddManagerTx = await TokenPriceProviderWrapper.contract.addManager(account);
        await TokenPriceProviderWrapper.verboseWaitForTransaction(TokenPriceProviderAddManagerTx, `Set ${account} as the manager of the TokenPriceProvider`);
    }

    ////////////////////////////////////
    // Set contracts' owners
    ////////////////////////////////////

    const wrappers = [ENSResolverWrapper, ENSManagerWrapper, WalletFactoryWrapper, ModuleRegistryWrapper, CompoundRegistryWrapper];
    for (let idx = 0; idx < wrappers.length; idx++) {
        let wrapper = wrappers[idx];
        const changeOwnerTx = await wrapper.contract.changeOwner(config.contracts.MultiSigWallet);
        await wrapper.verboseWaitForTransaction(changeOwnerTx, `Set the MultiSig as the owner of ${wrapper._contract.contractName}`);
    }
};

module.exports = {
    deploy
};