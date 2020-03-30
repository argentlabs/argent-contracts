const MultiSig = require('../build/MultiSigWallet');

const DeployManager = require('../utils/deploy-manager.js');
const MultisigExecutor = require('../utils/multisigexecutor.js');


async function main() { 

    // Read Command Line Arguments
    let idx = process.argv.indexOf("--network");
    const network = process.argv[idx + 1]; 

    idx = process.argv.indexOf("--threshold");
    const threshold = process.argv[idx + 1];
    
    // Setup deployer
    const manager = new DeployManager(network);
	await manager.setup();
	const configurator = manager.configurator;
	const deployer = manager.deployer;
    const deploymentWallet = deployer.signer;
    const config = configurator.config;

    const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

    // deregister
    await multisigExecutor.executeCall(MultiSigWrapper, "changeThreshold", [threshold]);

}

main().catch(err => {
    throw err;
});