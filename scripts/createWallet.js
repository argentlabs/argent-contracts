// Example Usage:
// node createWallet.js --network dev --ens john --owner 0x10391442e6ca847151372b6c7cbcc1fd06afda86

const WalletFactory = require('../build/WalletFactory');
const MultiSigWallet = require('../build/MultiSigWallet');

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
    const manager = deployer.signer;

    idx = process.argv.indexOf("--ens");
    const walletEns = idx > -1 ? process.argv[idx + 1] : Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5);

    idx = process.argv.indexOf("--owner");
    const owner = idx > -1 ? process.argv[idx + 1] : manager.address;

    const config = configurator.config;
    console.log('Config:', config);

    const walletFactoryWrapper = await deployer.wrapDeployedContract(WalletFactory, config.contracts.WalletFactory);
    const multisigWrapper = await deployer.wrapDeployedContract(MultiSigWallet, config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(multisigWrapper, manager, config.multisig.autosign);

    // Make manager a temporary manager of WalletFactory to facilitate wallet initialization
    let revokeManager = false;
    if (!await walletFactoryWrapper.managers(manager.address)) {
        console.log(`Adding accounts[0] (${manager.address}) as Manager of WalletFactory...`)
        await multisigExecutor.executeCall(walletFactoryWrapper, "addManager", [manager.address]);
        revokeManager = true;
    }

    // Create Wallet
    console.log("Creating new wallet...");
    const modules = [
        config.modules.GuardianManager,
        config.modules.LockManager,
        config.modules.RecoveryManager,
        config.modules.ApprovedTransfer,
        config.modules.TransferManager,
        config.modules.TokenExchanger,
        config.modules.MakerV2Manager
    ];
    const tx = await (walletFactoryWrapper.from && walletFactoryWrapper.from(manager) || walletFactoryWrapper).createWallet(owner, modules, walletEns);
    const txReceipt = await walletFactoryWrapper.verboseWaitForTransaction(tx);
    const walletAddress = txReceipt.events.find(log => log.event === "WalletCreated").args["_wallet"];
    console.log(`New wallet ${walletEns}.${config.ENS.domain} successfully created at address ${walletAddress} for owner ${owner}.`);

    // Remove temporary manager from WalletFactory
    if (revokeManager === true) {
        console.log(`Removing manager (${manager.address}) as Manager of WalletFactory...`)
        await multisigExecutor.executeCall(walletFactoryWrapper, "revokeManager", [manager.address]);
    }
}

main().catch(err => {
    throw err;
});
