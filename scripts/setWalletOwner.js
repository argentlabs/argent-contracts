// Example Usage:
// node setWalletOwner.js --network fuse.dev --wallet 0xF3134e982bcf6FA1CA173f5361DB730DF43a9eEc --newOwner 0xB8Ce4A040E8aA33bBe2dE62E92851b7D7aFd52De

const WalletOwnershipManager = require('../build/WalletOwnershipManager');
const MultiSig = require('../build/MultiSigWallet');

const MultisigExecutor = require('../utils/multisigexecutor.js');
const DeployManager = require('../utils/deploy-manager.js');

async function main() {

    // Read Command Line Arguments
    let idx = process.argv.indexOf("--network");
    const network = process.argv[idx + 1];

    const deployManager = new DeployManager(network);
    await deployManager.setup();

    const configurator = deployManager.configurator;
    const deployer = deployManager.deployer;

    idx = process.argv.indexOf("--wallet");
    const walletAddress = process.argv[idx + 1];

    idx = process.argv.indexOf("--newOwner");
    const newOwner = process.argv[idx + 1];

    const config = configurator.config;
    console.log('Config:', config);

    const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deployer.signer, config.multisig.autosign);

    const walletOwnershipManagerWrapper = await deployer.wrapDeployedContract(WalletOwnershipManager, config.modules.WalletOwnershipManager);
    await multisigExecutor.executeCall(walletOwnershipManagerWrapper, "setOwner", [walletAddress, newOwner]);
}

main().catch(err => {
    throw err;
});
