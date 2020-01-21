// Usage: ./execute.sh register.js staging --module 0x9ABb5Db4B23A866ffd649716c6ce2674b2C28C17abc --name GuardianManager

const ModuleRegistry = require('../build/ModuleRegistry');
const MultiSig = require('../build/MultiSigWallet');

const utils = require('../utils/utilities.js');
const DeployManager = require('../utils/deploy-manager.js');
const MultisigExecutor = require('../utils/multisigexecutor.js');


async function main() { 

    // Read Command Line Arguments
    let idx = process.argv.indexOf("--network");
    const network = process.argv[idx + 1]; 

    idx = process.argv.indexOf("--module");
    const targetModule = process.argv[idx + 1];

    idx = process.argv.indexOf("--name");
    const targetName = process.argv[idx + 1];
    
    // Setup deployer
    const manager = new DeployManager(network);
	await manager.setup();
	const configurator = manager.configurator;
	const deployer = manager.deployer;
    const deploymentWallet = deployer.signer;
    const config = configurator.config;

    const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
    const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

    // deregister
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule", [targetModule, utils.asciiToBytes32(targetName)]);

}

main().catch(err => {
    throw err;
});