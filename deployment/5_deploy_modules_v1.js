const GuardianStorage = require('../build/GuardianStorage');
const TransferStorage = require('../build/TransferStorage');
const DappStorage = require('../build/DappStorage');

const GuardianManager = require('../build/GuardianManager');
const TokenExchanger = require('../build/TokenExchanger');
const LockManager = require('../build/LockManager');
const RecoveryManager = require('../build/RecoveryManager');

const DeployManager = require('../utils/deploy-manager.js');

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
    // Deploy the Dapp Storage
    const DappStorageWrapper = await deployer.deploy(DappStorage);

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
    // Deploy the TokenExchanger module
    const TokenExchangerWrapper = await deployer.deploy(
        TokenExchanger,
        {},
        config.contracts.ModuleRegistry,
        GuardianStorageWrapper.contractAddress,
        config.Kyber.contract,
        config.contracts.MultiSigWallet,
        config.settings.feeRatio || 0);

    ///////////////////////////////////////////////////
    // Update config and Upload ABIs
    ///////////////////////////////////////////////////

    configurator.updateModuleAddresses({
        GuardianStorage: GuardianStorageWrapper.contractAddress,
        TransferStorage: TransferStorageWrapper.contractAddress,
        DappStorage: DappStorageWrapper.contractAddress,
        GuardianManager: GuardianManagerWrapper.contractAddress,
        LockManager: LockManagerWrapper.contractAddress,
        RecoveryManager: RecoveryManagerWrapper.contractAddress,
        TokenExchanger: TokenExchangerWrapper.contractAddress
    });

    const gitHash = require('child_process').execSync('git rev-parse HEAD').toString('utf8').replace(/\n$/, '');
    configurator.updateGitHash(gitHash);

    await configurator.save();

    await Promise.all([
        abiUploader.upload(GuardianStorageWrapper, "modules"),
        abiUploader.upload(TransferStorageWrapper, "modules"),
        abiUploader.upload(DappStorageWrapper, "modules"),
        abiUploader.upload(GuardianManagerWrapper, "modules"),
        abiUploader.upload(LockManagerWrapper, "modules"),
        abiUploader.upload(RecoveryManagerWrapper, "modules"),
        abiUploader.upload(TokenExchangerWrapper, "modules")
    ]);

    console.log('Config:', config);
};

module.exports = {
    deploy
};