// Example Usage:
// node recovery.js finalize --network fuse.dev -wallet $walletAddress --guardianPk $pk
// node recovery.js execute --network fuse.dev -wallet $walletAddress --guardianPk $pk -- newOwner $newOwner

const GuardianManager = require('../../build/GuardianManager');
const RecoveryManager = require("../../build/RecoveryManager");
const Wallet = require("../../build/BaseWallet");

const DeployManager = require('../../utils/deploy-manager.js');
const RelayManager = require('../../utils/relay-manager');
const ethers = require("ethers");

async function main() {
    const type = process.argv.indexOf("execute") !== -1 ? 'execute' : 'finalize'

    // Read Command Line Arguments
    idx = process.argv.indexOf("--network");
    const network = process.argv[idx + 1];

    idx = process.argv.indexOf("--wallet");
    const walletAddress = process.argv[idx + 1];

    idx = process.argv.indexOf("--guardianPk");
    const guardianPk = process.argv[idx + 1];

    const guardianWallet = guardianPk ? new ethers.Wallet(guardianPk) : manager

    const deployManager = new DeployManager(network);
    await deployManager.setup();

    const configurator = deployManager.configurator;
    const deployer = deployManager.deployer;
    const manager = deployer.signer;
   
    const config = configurator.config;
    console.log('Config:', config);

    const userWallet = await deployer.wrapDeployedContract(Wallet, walletAddress);
    const RecoveryManagerWrapper = await deployer.wrapDeployedContract(RecoveryManager, config.modules.RecoveryManager);
    const relayManager = new RelayManager([ deployer ], 'fuse');

    if (type === 'execute') {
        idx = process.argv.indexOf("--newOwner");
        const newOwnerAddress = process.argv[idx + 1];
        const response = await relayManager.relay(RecoveryManagerWrapper, 'executeRecovery', [walletAddress, newOwnerAddress], userWallet, [guardianWallet]);
        console.log({ response })
    } else {
        console.log('finalizing the recovery')
        const response = await relayManager.relay(RecoveryManagerWrapper, 'finalizeRecovery', [walletAddress], userWallet, []);
        console.log({ response })
    }

}

main().catch(err => {
    console.error(err)
    throw err;
});
