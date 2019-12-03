// Example Usage:
// node setWalletOwner.js --network fuse.dev --wallet 0x0B867891bC79F6BfB46E8cea4F4D2cB8A1F7AEcb --newOwner 0xF3a4C2862188781365966A040B1f47b9614b2DC7

const WalletOwnershipManager = require('../build/WalletOwnershipManager');

const DeployManager = require('../utils/deploy-manager.js');

async function main() {

    // Read Command Line Arguments
    let idx = process.argv.indexOf("--network");
    const network = process.argv[idx + 1];

    const deployManager = new DeployManager(network);
    await deployManager.setup();

    const configurator = deployManager.configurator;
    const deployer = deployManager.deployer;
    const manager = deployer.signer;

    idx = process.argv.indexOf("--wallet");
    const walletAddress = process.argv[idx + 1];

    idx = process.argv.indexOf("--newOwner");
    const newOwner = process.argv[idx + 1];

    const config = configurator.config;
    console.log('Config:', config);

    const walletOwnershipManagerWrapper = await deployer.wrapDeployedContract(WalletOwnershipManager, config.modules.WalletOwnershipManager);

    console.log("Setting new wallet owner...");
    try {
        const tx = await walletOwnershipManagerWrapper.setOwner(walletAddress, newOwner);
        const txReceipt = await walletOwnershipManagerWrapper.verboseWaitForTransaction(tx);
        console.log(txReceipt)
    } catch (e) {
        console.log(e)
    }
}

main().catch(err => {
    throw err;
});
