const GuardianStorage = require('../build/GuardianStorage');
const TransferStorage = require('../build/TransferStorage');

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

const DeployManager = require('../utils/deploy-manager.js');

/////////////////////////////////////////////////////////
//                 Version 1.4
/////////////////////////////////////////////////////////

const deploy = async (network, secret) => {

    ////////////////////////////////////
    // Setup
    ////////////////////////////////////

    const manager = new DeployManager(network);
    await manager.setup();

    const configurator = manager.configurator;
    const deployer = manager.deployer;
    const abiUploader = manager.abiUploader;

    const config = configurator.config;
    console.log(config);

    ////////////////////////////////////
    // Deploy Storage
    ////////////////////////////////////

    // Deploy the Guardian Storage
    const GuardianStorageWrapper = await deployer.deploy(GuardianStorage);
    // Deploy the Transfer Storage
    const TransferStorageWrapper = await deployer.deploy(TransferStorage);

    ////////////////////////////////////
    // Deploy Modules
    ////////////////////////////////////

    // Deploy the GuardianManager module
    const GuardianManagerWrapper = await deployer.deploy(
        GuardianManager,
        {},
        config.contracts.ModuleRegistry,
        GuardianStorageWrapper.contractAddress,
        config.settings.securityPeriod || 0,
        config.settings.securityWindow || 0);
    // Deploy the LockManager module
    const LockManagerWrapper = await deployer.deploy(
        LockManager,
        {},
        config.contracts.ModuleRegistry,
        GuardianStorageWrapper.contractAddress,
        config.settings.lockPeriod || 0);
    // Deploy the RecoveryManager module
    const RecoveryManagerWrapper = await deployer.deploy(
        RecoveryManager,
        {},
        config.contracts.ModuleRegistry,
        GuardianStorageWrapper.contractAddress,
        config.settings.recoveryPeriod || 0,
        config.settings.lockPeriod || 0);
    // Deploy the ApprovedTransfer module
    const ApprovedTransferWrapper = await deployer.deploy(
        ApprovedTransfer,
        {},
        config.contracts.ModuleRegistry,
        GuardianStorageWrapper.contractAddress);
    // Deploy the TransferManager module
    const TransferManagerWrapper = await deployer.deploy(
        TransferManager,
        {},
        config.contracts.ModuleRegistry,
        config.modules.TransferStorage,
        config.modules.GuardianStorage,
        config.contracts.TokenPriceProvider,
        config.settings.securityPeriod || 0,
        config.settings.securityWindow || 0,
        config.settings.defaultLimit || '1000000000000000000',
        ['test', 'staging', 'prod'].includes(network) ? config.modules.TokenTransfer : '0x0000000000000000000000000000000000000000'
    );
    // Deploy the TokenExchanger module
    const TokenExchangerWrapper = await deployer.deploy(
        TokenExchanger,
        {},
        config.contracts.ModuleRegistry,
        GuardianStorageWrapper.contractAddress,
        config.Kyber.contract,
        config.contracts.MultiSigWallet,
        config.settings.feeRatio || 0);
    // Deploy the NFTTransfer module
    const NftTransferWrapper = await deployer.deploy(
        NftTransfer,
        {},
        config.contracts.ModuleRegistry,
        config.modules.GuardianStorage,
        config.CryptoKitties.contract
    );
    // Deploy the MakerManager module
    const MakerManagerWrapper = await deployer.deploy(
        MakerManager,
        {},
        config.contracts.ModuleRegistry,
        config.modules.GuardianStorage,
        config.defi.maker.tub,
        config.defi.uniswap.factory
    );
    // Deploy the CompoundManager module
    const CompoundManagerWrapper = await deployer.deploy(
        CompoundManager,
        {},
        config.contracts.ModuleRegistry,
        config.modules.GuardianStorage,
        config.defi.compound.comptroller,
        config.contracts.CompoundRegistry
    );
    // Deploy the UniswapManager module
    const UniswapManagerWrapper = await deployer.deploy(
        UniswapManager,
        {},
        config.contracts.ModuleRegistry,
        config.modules.GuardianStorage,
        config.defi.uniswap.factory
    );
    // Deploy MakerManagerV2 first version
    const MakerV2ManagerWrapper = await deployer.deploy(
        MakerV2Manager,
        {},
        config.contracts.ModuleRegistry,
        config.modules.GuardianStorage,
        config.defi.maker.migration,
        config.defi.maker.pot
    );

    ///////////////////////////////////////////////////
    // Update config and Upload ABIs
    ///////////////////////////////////////////////////

    configurator.updateModuleAddresses({
        GuardianStorage: GuardianStorageWrapper.contractAddress,
        TransferStorage: TransferStorageWrapper.contractAddress,
        GuardianManager: GuardianManagerWrapper.contractAddress,
        LockManager: LockManagerWrapper.contractAddress,
        RecoveryManager: RecoveryManagerWrapper.contractAddress,
        ApprovedTransfer: ApprovedTransferWrapper.contractAddress,
        TransferManager: TransferManagerWrapper.contractAddress,
        TokenExchanger: TokenExchangerWrapper.contractAddress,
        NftTransfer: NftTransferWrapper.contractAddress,
        MakerManager: MakerManagerWrapper.contractAddress,
        CompoundManager: CompoundManagerWrapper.contractAddress,
        UniswapManager: UniswapManagerWrapper.contractAddress,
        MakerV2Manager: MakerV2ManagerWrapper.contractAddress
    });

    const gitHash = require('child_process').execSync('git rev-parse HEAD').toString('utf8').replace(/\n$/, '');
    configurator.updateGitHash(gitHash);

    await configurator.save();

    await Promise.all([
        abiUploader.upload(GuardianStorageWrapper, "modules"),
        abiUploader.upload(TransferStorageWrapper, "modules"),
        abiUploader.upload(GuardianManagerWrapper, "modules"),
        abiUploader.upload(LockManagerWrapper, "modules"),
        abiUploader.upload(RecoveryManagerWrapper, "modules"),
        abiUploader.upload(ApprovedTransferWrapper, "modules"),
        abiUploader.upload(TransferManagerWrapper, "modules"),
        abiUploader.upload(TokenExchangerWrapper, "modules"),
        abiUploader.upload(NftTransferWrapper, "modules"),
        abiUploader.upload(MakerManagerWrapper, "modules"),
        abiUploader.upload(CompoundManagerWrapper, "modules"),
        abiUploader.upload(UniswapManagerWrapper, "modules"),
        abiUploader.upload(MakerV2ManagerWrapper, "modules")
    ]);

    console.log('Config:', config);
};

module.exports = {
    deploy
};