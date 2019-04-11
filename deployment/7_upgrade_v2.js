const NftTransfer = require('../build/NftTransfer');
const ModuleRegistry = require('../build/ModuleRegistry');
const MultiSig = require('../build/MultiSigWallet');
const Upgrader = require('../build/SimpleUpgrader');

const utils = require('../utils/utilities.js');
const DeployManager = require('../utils/deploy-manager.js');
const MultisigExecutor = require('../utils/multisigexecutor.js');
const semver = require('semver');

const TARGET_VERSION = "2.0";

const deploy = async (network, secret) => {

    const newModuleNames = ["NftTransfer"];
    const newModuleWrappers = [];
    const deprecatedModuleNames = [];
    const compatibility = 1;
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
    const deploymentWallet = deployer.wallet;
    const config = configurator.config;

    const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
    const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);
    
    console.log('Config:', config);

    ////////////////////////////////////
    // Deploy new modules
    ////////////////////////////////////

    const NftTransferWrapper = await deployer.deploy(
        NftTransfer,
        {},
        config.contracts.ModuleRegistry,
        config.contracts.GuardianStorage
    );
    newModuleWrappers.push(NftTransferWrapper);  
    
    ///////////////////////////////////////////////////
    // Update config and Upload new module ABIs
    ///////////////////////////////////////////////////

    configurator.updateModuleAddresses({
        NftTransfer: NftTransferWrapper.contractAddress
    });

    const gitHash = require('child_process').execSync('git rev-parse HEAD').toString('utf8').replace(/\n$/, '');
    configurator.updateGitHash(gitHash);
    await configurator.save();

    await Promise.all([
        abiUploader.upload(NftTransferWrapper, "modules")
    ]);

    console.log('Config:', config);

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

    const toAdd = newModuleNWrappers.map((wrapper) => {
        return {
            'name': utils.asciiToBytes32(wrapper._contract.contractName),
            'address': wrapper.contractAddress
        };
    });
    let fingerprint;

    const versions = versionUploader.load(compatibility);
    for (let idx = 0; idx < versions.length; idx++) {
        const version = versions[idx];
        const moduleNames = deprecatedModuleNames.concat(newModuleNames);
        const toRemove = version.modules.filter(module => moduleNames.includes(module.name));
        const toKeep = version.modules.filter(module => !moduleNames.includes(module.name));

        if(idx == 0) {
            let modules = toKeep.concat(toAdd);
            fingerprint = utils.versionFingerprint(modules);
            newVersion.version = semver.lt(version.version, TARGET_VERSION)? TARGET_VERSION : semver.inc(version.version, 'minor');
            newVersion.createdAt = Math.floor((new Date()).getTime() / 1000);
            newVersion.modules = modules;
            newVersion.fingerprint = fingerprint;

            ////////////////////////////////////
            // Deregister old modules
            ////////////////////////////////////

            for (let i = 0; i < toRemove.length; i++) {
                await multisigExecutor.executeCall(ModuleRegistryWrapper, "deregisterModule", [toRemove.address]);
            }
        }
        
        const UpgraderWrapper = await deployer.deploy(
            Upgrader,
            {},
            toRemove.map((module) => {return module.address;}),
            toAdd.map((module) => {return module.address;})
        );
        const upgraderName = version.fingerprint + '_' + fingerprint; 
        await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerUpgrader", [UpgraderWrapper.contractAddress, upgraderName]);
    };

    ////////////////////////////////////
    // Upload Version
    ////////////////////////////////////

    await versionUploader.upload(newVersion);

}

module.exports = {
	deploy
};