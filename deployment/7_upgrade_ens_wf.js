const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const WalletFactory = require('../build/WalletFactory');
const MultiSig = require('../build/MultiSigWallet');
const BaseWallet = require('../build/BaseWallet');

const DeployManager = require('../utils/deploy-manager.js');
const MultisigExecutor = require('../utils/multisigexecutor.js');
const utils = require('../utils/utilities.js');

const deploy = async (network) => {

    ////////////////////////////////////
    // Setup
    ////////////////////////////////////

    const manager = new DeployManager(network);
    await manager.setup();
    
    const configurator = manager.configurator;
    const deployer = manager.deployer;
    const abiUploader = manager.abiUploader;
    const config = configurator.config;
    const domain = config.ENS.domain;
    
    // Instantiate the ENS Registry and existing WalletFactory and ENSManager
    const ENSManagerWrapper = await deployer.wrapDeployedContract(ENSManager, config.contracts.ENSManager);
    const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
    const ENSResolverWrapper = await deployer.wrapDeployedContract(ENSResolver, config.contracts.ENSResolver);

    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deployer.signer, config.multisig.autosign);

    ////////////////////////////////////
    // Deploy new contracts
    ////////////////////////////////////

    // Deploy the updated ENSManager
    const NewENSManagerWrapper = await deployer.deploy(ENSManager, {}, domain, utils.namehash(domain), config.ENS.ensRegistry, config.contracts.ENSResolver);

    // Deploy new BaseWallet
    const NewBaseWalletWrapper = await deployer.deploy(BaseWallet);

    // Deploy new Wallet Factory
    const NewWalletFactoryWrapper = await deployer.deploy(
        WalletFactory, {}, 
        config.contracts.ModuleRegistry, 
        NewBaseWalletWrapper.contractAddress, 
        NewENSManagerWrapper.contractAddress);
    
    ////////////////////////////////////
    // Configure WalletFactory
    ////////////////////////////////////

    //Set the GuardianStorage address for the new WalletFactory
    const setGuardianStorageTx = await NewWalletFactoryWrapper.contract.changeGuardianStorage(config.modules.GuardianStorage);
    await NewWalletFactoryWrapper.verboseWaitForTransaction(setGuardianStorageTx, `Set the GuardianStorage address`);

    // Set the backend keys as managers for the new WalletFactory
    for (idx in config.backend.accounts) {
        let account = config.backend.accounts[idx];
        const WalletFactoryAddManagerTx = await NewWalletFactoryWrapper.contract.addManager(account);
        await NewWalletFactoryWrapper.verboseWaitForTransaction(WalletFactoryAddManagerTx, `Set ${account} as the manager of the WalletFactory`);
    }

    // Set the multisig as the owner of the new WalletFactory
    const changeOwnerTx = await NewWalletFactoryWrapper.contract.changeOwner(config.contracts.MultiSigWallet);
    await NewWalletFactoryWrapper.verboseWaitForTransaction(changeOwnerTx, `Set the MultiSig as the owner of the WalletFactory`);

    ////////////////////////////////////
    // Configure ENS
    ////////////////////////////////////

    // Set the new WalletFactory as a manager of the new ENSManager
    const ENSManagerAddManagerTx = await NewENSManagerWrapper.contract.addManager(NewWalletFactoryWrapper.contractAddress);
    await NewENSManagerWrapper.verboseWaitForTransaction(ENSManagerAddManagerTx, 'Set the WalletFactory as the manager of the ENS Manager');

    // Set the MultiSig as the owner of the new ENSManager
    const ChangeENSManagerOwnerTx = await NewENSManagerWrapper.contract.changeOwner(config.contracts.MultiSigWallet);
    await NewENSManagerWrapper.verboseWaitForTransaction(ChangeENSManagerOwnerTx, `Set the MultiSig as the owner of ENSManager`);

    // Decomission old ENSManager 
    await multisigExecutor.executeCall(ENSManagerWrapper, "changeRootnodeOwner", ["0x0000000000000000000000000000000000000000"]);
    console.log(`Owner of ${domain} changed from from old ENSManager to 0x0000000000000000000000000000000000000000`);
    
    // Set new ENSManager as a manager of ENSREsolver
    await multisigExecutor.executeCall(ENSResolverWrapper, "addManager", [NewENSManagerWrapper.contractAddress]);

    ///////////////////////////////////////////////////
    // Update config and Upload ABIs
    ///////////////////////////////////////////////////

    configurator.updateInfrastructureAddresses({
        ENSManager: NewENSManagerWrapper.contractAddress,
        WalletFactory: NewWalletFactoryWrapper.contractAddress,
        BaseWallet: NewBaseWalletWrapper.contractAddress
    });
    await configurator.save();

    await Promise.all([
        abiUploader.upload(NewENSManagerWrapper, "contracts"),
        abiUploader.upload(NewWalletFactoryWrapper, "contracts"),
        abiUploader.upload(NewBaseWalletWrapper, "contracts")
    ]);
}


module.exports = {
    deploy
};