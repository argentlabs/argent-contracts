const ModuleRegistry = require('../build/ModuleRegistry');
const MultiSig = require('../build/MultiSigWallet');
const Upgrader = require('../build/SimpleUpgrader');
const LegacyUpgrader = require('../build/LegacySimpleUpgrader');
// const MakerRegistry = require('../build/MakerRegistry');
// const ScdMcdMigration = require('../build/ScdMcdMigration');
const MakerV2Manager = require('../build/MakerV2Manager');

const utils = require('../utils/utilities.js');
const DeployManager = require('../utils/deploy-manager.js');
const MultisigExecutor = require('../utils/multisigexecutor.js');
const semver = require('semver');

const TARGET_VERSION = "1.5.0";
const MODULES_TO_ENABLE = ["MakerV2Manager"];
const MODULES_TO_DISABLE = [];

const BACKWARD_COMPATIBILITY = 5;

const deploy = async (network) => {

    if (!['kovan', 'kovan-fork', 'staging', 'prod'].includes(network)) {
        throw new Error(`The MakerManagerV2 module cannot currently be deployed on ${network}`)
    }

    const newModuleWrappers = [];
    const newVersion = {};

    ////////////////////////////////////
    // Setup
    ////////////////////////////////////

    const manager = new DeployManager(network);
    await manager.setup();

    const configurator = manager.configurator;
    const deployer = manager.deployer;
    const abiUploader = manager.abiUploader;
    const versionUploader = manager.versionUploader;
    const deploymentWallet = deployer.signer;
    const config = configurator.config;

    const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
    const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

    console.log('Config:', config);

    // ////////////////////////////////////
    // // Deploy utility contracts
    // ////////////////////////////////////

    // // Deploy and configure Maker Registry
    // const MakerRegistryWrapper = await deployer.deploy(MakerRegistry);
    // const ScdMcdMigrationWrapper = await deployer.wrapDeployedContract(ScdMcdMigration, config.defi.maker.migration);
    // const wethJoinAddress = await ScdMcdMigrationWrapper.wethJoin();
    // const addCollateralTransaction = await MakerRegistryWrapper.addCollateral(wethJoinAddress);
    // await MakerRegistryWrapper.verboseWaitForTransaction(addCollateralTransaction, `Adding join adapter ${wethJoinAddress} to the MakerRegistry`);
    // const changeMakerRegistryOwnerTx = await MakerRegistryWrapper.changeOwner(config.contracts.MultiSigWallet);
    // await MakerRegistryWrapper.verboseWaitForTransaction(changeMakerRegistryOwnerTx, `Set the MultiSig as the owner of the MakerRegistry`);

    ////////////////////////////////////
    // Deploy new modules
    ////////////////////////////////////

    const MakerV2ManagerWrapper = await deployer.deploy(
        MakerV2Manager,
        {},
        config.contracts.ModuleRegistry,
        config.modules.GuardianStorage,
        config.defi.maker.migration,
        config.defi.maker.pot,
        // MakerRegistryWrapper.contractAddress
    );
    newModuleWrappers.push(MakerV2ManagerWrapper);

    ///////////////////////////////////////////////////
    // Update config and Upload new module ABIs
    ///////////////////////////////////////////////////

    configurator.updateModuleAddresses({
        MakerV2Manager: MakerV2ManagerWrapper.contractAddress
    });

    // configurator.updateInfrastructureAddresses({
    //     MakerRegistry: MakerRegistryWrapper.contractAddress
    // });

    const gitHash = require('child_process').execSync('git rev-parse HEAD').toString('utf8').replace(/\n$/, '');
    configurator.updateGitHash(gitHash);
    await configurator.save();

    await Promise.all([
        abiUploader.upload(MakerV2ManagerWrapper, "modules"),
        // abiUploader.upload(MakerRegistryWrapper, "contracts")
    ]);

    ////////////////////////////////////
    // Register new modules
    ////////////////////////////////////

    for (let idx = 0; idx < newModuleWrappers.length; idx++) {
        let wrapper = newModuleWrappers[idx];
        await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule", [wrapper.contractAddress, utils.asciiToBytes32(wrapper._contract.contractName)]);
    }

    ////////////////////////////////////
    // Deploy and Register upgraders
    ////////////////////////////////////


    let fingerprint;
    const versions = await versionUploader.load(BACKWARD_COMPATIBILITY);
    for (let idx = 0; idx < versions.length; idx++) {
        const version = versions[idx];
        let toAdd, toRemove;
        if (idx === 0) {
            const moduleNamesToRemove = MODULES_TO_DISABLE.concat(MODULES_TO_ENABLE);
            toRemove = version.modules.filter(module => moduleNamesToRemove.includes(module.name));
            toAdd = newModuleWrappers.map((wrapper) => {
                return {
                    'address': wrapper.contractAddress,
                    'name': wrapper._contract.contractName
                };
            });
            const toKeep = version.modules.filter(module => !moduleNamesToRemove.includes(module.name));
            const modulesInNewVersion = toKeep.concat(toAdd);
            fingerprint = utils.versionFingerprint(modulesInNewVersion);
            newVersion.version = semver.lt(version.version, TARGET_VERSION) ? TARGET_VERSION : semver.inc(version.version, 'patch');
            newVersion.createdAt = Math.floor((new Date()).getTime() / 1000);
            newVersion.modules = modulesInNewVersion;
            newVersion.fingerprint = fingerprint;

            ////////////////////////////////////
            // Deregister old modules
            ////////////////////////////////////

            for (let i = 0; i < toRemove.length; i++) {
                await multisigExecutor.executeCall(ModuleRegistryWrapper, "deregisterModule", [toRemove[i].address]);
            }
        } else {
            // add all modules present in newVersion that are not present in version
            toAdd = newVersion.modules.filter(module => !version.modules.map(m => m.address).includes(module.address));
            // remove all modules from version that are no longer present in newVersion
            toRemove = version.modules.filter(module => !newVersion.modules.map(m => m.address).includes(module.address));
        }

        const upgraderName = version.fingerprint + '_' + fingerprint;

        let UpgraderWrapper;
        if (version.modules.map(m => m.name).includes('ModuleManager')) {
            // make sure ModuleManager is always the last to be removed if it needs to be removed
            toRemove.push(toRemove.splice(toRemove.findIndex(({ name }) => name === 'ModuleManager'), 1)[0]);
            // this is an "old-style" Upgrader (to be used with ModuleManager)
            UpgraderWrapper = await deployer.deploy(
                LegacyUpgrader,
                {},
                toRemove.map(module => module.address),
                toAdd.map(module => module.address)
            );
        } else {
            // this is a "new-style" Upgrader Module (to be used with the addModule method of TransferManager or any module deployed after it)
            UpgraderWrapper = await deployer.deploy(
                Upgrader,
                {},
                config.contracts.ModuleRegistry,
                toRemove.map(module => module.address),
                toAdd.map(module => module.address)
            );
            await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule", [UpgraderWrapper.contractAddress, utils.asciiToBytes32(upgraderName)]);
        }
        await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerUpgrader", [UpgraderWrapper.contractAddress, utils.asciiToBytes32(upgraderName)]);

    };

    ////////////////////////////////////
    // Upload Version
    ////////////////////////////////////

    await versionUploader.upload(newVersion);

}

module.exports = {
    deploy
};