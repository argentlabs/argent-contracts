const MakerManager = require('../build/MakerManager');
const CompoundManager = require('../build/CompoundManager');
const UniswapManager = require('../build/UniswapManager');
const CompoundRegistry = require('../build/CompoundRegistry');
const ModuleRegistry = require('../build/ModuleRegistry');
const MultiSig = require('../build/MultiSigWallet');
const Upgrader = require('../build/SimpleUpgrader');

const utils = require('../utils/utilities.js');
const DeployManager = require('../utils/deploy-manager.js');
const MultisigExecutor = require('../utils/multisigexecutor.js');
const semver = require('semver');

const TARGET_VERSION = "1.2.3";
const MODULES_TO_ENABLE = ["MakerManager"];
const MODULES_TO_DISABLE = ["InvestManager", "LoanManager"];
const BACKWARD_COMPATIBILITY = 3;

const deploy = async (network) => {

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

    ////////////////////////////////////
    // Deploy utility contracts
    ////////////////////////////////////

/*     const CompoundRegistryWrapper = await deployer.deploy(CompoundRegistry);

    // configure Compound Registry
    for (let underlying in config.defi.compound.markets) {
        const cToken = config.defi.compound.markets[underlying];
        const addUnderlyingTransaction = await CompoundRegistryWrapper.addCToken(underlying, cToken);
        await CompoundRegistryWrapper.verboseWaitForTransaction(addUnderlyingTransaction, `Adding unerlying ${underlying} with cToken ${cToken} to the registry`);
    }
    const changeCompoundRegistryOwnerTx = await CompoundRegistryWrapper.changeOwner(config.contracts.MultiSigWallet);
    await CompoundRegistryWrapper.verboseWaitForTransaction(changeCompoundRegistryOwnerTx, `Set the MultiSig as the owner of the CompoundRegistry`); */

    ////////////////////////////////////
    // Deploy new modules
    ////////////////////////////////////

    const MakerManagerWrapper = await deployer.deploy(
        MakerManager,
        {},
        config.contracts.ModuleRegistry,
        config.modules.GuardianStorage,
        config.defi.maker.tub, 
        config.defi.uniswap.factory
    );
    newModuleWrappers.push(MakerManagerWrapper); 

/*     const CompoundManagerWrapper = await deployer.deploy(
        CompoundManager,
        {},
        config.contracts.ModuleRegistry,
        config.modules.GuardianStorage,
        config.defi.compound.comptroller, 
        CompoundRegistryWrapper.contractAddress
    );
    newModuleWrappers.push(CompoundManagerWrapper); 

    const UniswapManagerWrapper = await deployer.deploy(
        UniswapManager,
        {},
        config.contracts.ModuleRegistry,
        config.modules.GuardianStorage,
        config.defi.uniswap.factory
    );
    newModuleWrappers.push(UniswapManagerWrapper);  */
    
    ///////////////////////////////////////////////////
    // Update config and Upload new module ABIs
    ///////////////////////////////////////////////////

    configurator.updateModuleAddresses({
        MakerManager: MakerManagerWrapper.contractAddress/* ,
        CompoundManager: CompoundManagerWrapper.contractAddress,
        UniswapManager: UniswapManagerWrapper.contractAddress */
    });

/*     configurator.updateInfrastructureAddresses({
        CompoundRegistry : CompoundRegistryWrapper.contractAddress
    }); */

    const gitHash = require('child_process').execSync('git rev-parse HEAD').toString('utf8').replace(/\n$/, '');
    configurator.updateGitHash(gitHash);
    await configurator.save();

    await Promise.all([
        abiUploader.upload(MakerManagerWrapper, "modules")/* ,
        abiUploader.upload(CompoundManagerWrapper, "modules"),
        abiUploader.upload(UniswapManagerWrapper, "modules"),
        abiUploader.upload(CompoundRegistryWrapper, "contracts") */
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

    const toAdd = newModuleWrappers.map((wrapper) => {
        return {
            'address': wrapper.contractAddress,
            'name': wrapper._contract.contractName
        };
    });
    let fingerprint; 

    const versions = await versionUploader.load(BACKWARD_COMPATIBILITY);
    for (let idx = 0; idx < versions.length; idx++) {
        const version = versions[idx];
        const moduleNames = MODULES_TO_DISABLE.concat(MODULES_TO_ENABLE);
        const toRemove = version.modules.filter(module => moduleNames.includes(module.name));
        const toKeep = version.modules.filter(module => !moduleNames.includes(module.name));
        if(idx == 0) {
            let modules = toKeep.concat(toAdd);
            fingerprint = utils.versionFingerprint(modules);
            newVersion.version = semver.lt(version.version, TARGET_VERSION)? TARGET_VERSION : semver.inc(version.version, 'patch');
            newVersion.createdAt = Math.floor((new Date()).getTime() / 1000);
            newVersion.modules = modules;
            newVersion.fingerprint = fingerprint;

            ////////////////////////////////////
            // Deregister old modules
            ////////////////////////////////////

            for (let i = 0; i < toRemove.length; i++) {
                await multisigExecutor.executeCall(ModuleRegistryWrapper, "deregisterModule", [toRemove[i].address]);
            }
        }
        
        const UpgraderWrapper = await deployer.deploy(
            Upgrader,
            {},
            toRemove.map((module) => {return module.address;}),
            toAdd.map((module) => {return module.address;})
        );
        const upgraderName = version.fingerprint + '_' + fingerprint; 
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