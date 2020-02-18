const CompoundRegistry = require('../build/CompoundRegistry');
const MultiSig = require('../build/MultiSigWallet');

const utils = require('../utils/utilities.js');
const DeployManager = require('../utils/deploy-manager.js');
const MultisigExecutor = require('../utils/multisigexecutor.js');


async function main() { 

    var add;

    // Read Command Line Arguments
    let idx = process.argv.indexOf("--network");
    const network = process.argv[idx + 1]; 

    idx = process.argv.indexOf("--add");
    if(idx > 0) {
        add = true;
    }
    else {
        idx = process.argv.indexOf("--remove");
        if(idx > 0) {
            add = false;
        }
        else {
            console.log("Error: Use --add or --remove to add or remove tokens from Compound");
            return;
        }
    }    

    idx = process.argv.indexOf("--token");
    const token = process.argv[idx + 1];

    idx = process.argv.indexOf("--ctoken");
    const ctoken = process.argv[idx + 1];
    
    // Setup deployer
    const manager = new DeployManager(network);
	await manager.setup();
	const configurator = manager.configurator;
	const deployer = manager.deployer;
    const deploymentWallet = deployer.signer;
    const config = configurator.config;

    const CompoundRegistryWrapper = await deployer.wrapDeployedContract(CompoundRegistry, config.contracts.CompoundRegistry);
    const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

    if(add) {
        console.log(`Adding token ${token} to Compound`);
        await multisigExecutor.executeCall(CompoundRegistryWrapper, "addCToken", [token, ctoken]);
    }
    else {
        console.log(`Removing token ${token} from Compound`);
        await multisigExecutor.executeCall(CompoundRegistryWrapper, "removeCToken", [token]);
    }
}

main().catch(err => {
    throw err;
});