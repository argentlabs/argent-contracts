// Usage: ./execute.sh updateBaseWallet.js staging

const BaseWallet = require('../build/BaseWallet');
const WalletFactory = require('../build/WalletFactory');
const MultiSigWallet = require('../build/MultiSigWallet');
const MultisigExecutor = require('../utils/multisigexecutor.js');
const DeployManager = require('../utils/deploy-manager.js');

const defaultNetwork = 'test';

async function main() {

    // Read Command Line Arguments
    let idx = process.argv.indexOf("--network");
    const network = idx > -1 ? process.argv[idx + 1] : defaultNetwork;

    const deployManager = new DeployManager(network);
    await deployManager.setup();
    const configurator = deployManager.configurator;
    const deployer = deployManager.deployer;
    const manager = deployer.signer;
    const config = configurator.config;
    console.log('Config:', config);

    // Deploy new BaseWallet
    console.log('Deploying new BaseWallet...')
    const BaseWalletWrapper = await deployer.deploy(BaseWallet);

    // Setup WalletFactory with new BaseWallet
    console.log('Setting up WalletFactory with new BaseWallet...')
    const walletFactoryWrapper = await deployer.wrapDeployedContract(WalletFactory, config.contracts.WalletFactory);
    const multisigWrapper = await deployer.wrapDeployedContract(MultiSigWallet, config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(multisigWrapper, manager, config.multisig.autosign);
    await multisigExecutor.executeCall(
        walletFactoryWrapper,
        "changeWalletImplementation",
        [BaseWalletWrapper.contractAddress]
    );

    console.log('Saving new config...')
    configurator.updateInfrastructureAddresses({ BaseWallet: BaseWalletWrapper.contractAddress });
    await configurator.save();
    await deployManager.abiUploader.upload(BaseWalletWrapper, "contracts")

    console.log('BaseWallet Update DONE.')
}

main().catch(err => {
    throw err;
});
