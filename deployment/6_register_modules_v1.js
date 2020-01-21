const ModuleRegistry = require('../build/ModuleRegistry');
const MultiSig = require('../build/MultiSigWallet');

const GuardianManager = require('../build/GuardianManager');
const TokenExchanger = require('../build/TokenExchanger');
const LockManager = require('../build/LockManager');
const RecoveryManager = require('../build/RecoveryManager');
const ApprovedTransfer = require('../build/ApprovedTransfer');
const TransferManager = require('../build/TransferManager');
const NftTransfer = require('../build/NftTransfer');
const MakerManager = require('../build/MakerManager');
const CompoundManager = require('../build/CompoundManager');
const UniswapManager = require('../build/UniswapManager');
const MakerV2Manager = require('../build/MakerV2Manager');

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
    const versionUploader = manager.versionUploader;

    const deploymentWallet = deployer.signer;

    const config = configurator.config;
    console.log('Config:', config);

    const GuardianManagerWrapper = await deployer.wrapDeployedContract(GuardianManager, config.modules.GuardianManager);
    const LockManagerWrapper = await deployer.wrapDeployedContract(LockManager, config.modules.LockManager);
    const RecoveryManagerWrapper = await deployer.wrapDeployedContract(RecoveryManager, config.modules.RecoveryManager);
    const ApprovedTransferWrapper = await deployer.wrapDeployedContract(ApprovedTransfer, config.modules.ApprovedTransfer);
    const TransferManagerWrapper = await deployer.wrapDeployedContract(TransferManager, config.modules.TransferManager);
    const TokenExchangerWrapper = await deployer.wrapDeployedContract(TokenExchanger, config.modules.TokenExchanger);
    const NftTransferWrapper = await deployer.wrapDeployedContract(NftTransfer, config.modules.NftTransfer);
    const MakerManagerWrapper = await deployer.wrapDeployedContract(MakerManager, config.modules.MakerManager);
    const CompoundManagerWrapper = await deployer.wrapDeployedContract(CompoundManager, config.modules.CompoundManager);
    const UniswapManagerWrapper = await deployer.wrapDeployedContract(UniswapManager, config.modules.UniswapManager);
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
        MakerManagerWrapper,
        CompoundManagerWrapper,
        UniswapManagerWrapper,
        MakerV2ManagerWrapper
    ];

    ////////////////////////////////////
    // Register modules
    ////////////////////////////////////

    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

    for (let idx = 0; idx < wrappers.length; idx++) {
        let wrapper = wrappers[idx];
        await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule", [wrapper.contractAddress, utils.asciiToBytes32(wrapper._contract.contractName)]);
    }

    ////////////////////////////////////
    // Upload Version
    ////////////////////////////////////

    const modules = wrappers.map((wrapper) => {
        return { address: wrapper.contractAddress, name: wrapper._contract.contractName };
    });
    const version = {
        modules: modules,
        fingerprint: utils.versionFingerprint(modules),
        version: "1.0.0",
        createdAt: Math.floor((new Date()).getTime() / 1000)
    }
    await versionUploader.upload(version);
};

module.exports = {
    deploy
};