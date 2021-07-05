// Example Usage:
// node createWallet.js --network dev --ens john --owner 0x10391442e6ca847151372b6c7cbcc1fd06afda86 (--salt abc123)

const WalletFactory = require('../../build/WalletFactory');
const MultiSigWallet = require('../../build/MultiSigWallet');
const GuardianManager = require('../../build/GuardianManager');
const Wallet = require("../../build/BaseWallet");

const MultisigExecutor = require('../../utils/multisigexecutor.js');
const DeployManager = require('../../utils/deploy-manager.js');
const RelayManager = require('../../utils/relay-manager');
const PkWallet = require('ethereumjs-wallet')
const ethers = require("ethers");

async function main() {

    // Read Command Line Arguments
    let idx = process.argv.indexOf("--network");
    const network = process.argv[idx + 1];

    idx = process.argv.indexOf("--wallet");
    const walletAddress = process.argv[idx + 1];

    idx = process.argv.indexOf("--guardian");
    const guardianAddress = process.argv[idx + 1];

    idx = process.argv.indexOf("--ownerPk");
    const ownerPk = process.argv[idx + 1];

    idx = process.argv.indexOf("--relay");
    const useRelay = idx === -1 ? false : true

    const deployManager = new DeployManager(network);
    await deployManager.setup();

    const configurator = deployManager.configurator;
    const deployer = deployManager.deployer;
    const manager = deployer.signer;

    const owner = ownerPk ? new ethers.Wallet(ownerPk) : manager
    
    const config = configurator.config;
    console.log('Config:', config);

    if (useRelay) {
        const WalletWrapper = await deployer.wrapDeployedContract(Wallet, walletAddress);
        const GuardianManagerWrapper = await deployer.wrapDeployedContract(GuardianManager, config.modules.GuardianManager);
        const relayManager = new RelayManager([ deployer ], 'fuse');
        const response = await relayManager.relay(GuardianManagerWrapper, 'addGuardian', [walletAddress, guardianAddress], WalletWrapper, [owner])
        console.log({ response })
    } else {
        const GuardianManagerWrapper = await deployer.wrapDeployedContract(GuardianManager, config.modules.GuardianManager);
        const response = await GuardianManagerWrapper.addGuardian(walletAddress, guardianAddress);
        console.log({ response })
    }
}

main().catch(err => {
    console.error(err)
    throw err;
});
