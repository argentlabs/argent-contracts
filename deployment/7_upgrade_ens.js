const ENSManager = require('../build/ArgentENSManager');
const ENSResolver = require('../build/ArgentENSResolver');
const WalletFactory = require('../build/WalletFactory');
const MultiSig = require('../build/MultiSigWallet');

const DeployManager = require('../utils/deploy-manager.js');
const MultisigExecutor = require('../utils/multisigexecutor.js');
const utils = require('../utils/utilities.js');

const deploy = async (network) => {
    const manager = new DeployManager(network);
    await manager.setup();
    const configurator = manager.configurator;
    const deployer = manager.deployer;
    const abiUploader = manager.abiUploader;
    const config = configurator.config;
    const domain = config.ENS.domain;
    
    // Instantiate the ENS Registry and existing WalletFactory and ENSManager
    const WalletFactoryWrapper = await deployer.wrapDeployedContract(WalletFactory, config.contracts.WalletFactory);
    const ENSManagerWrapper = await deployer.wrapDeployedContract(ENSManager, config.contracts.ENSManager);
    const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
    const ENSResolverWrapper = await deployer.wrapDeployedContract(ENSResolver, config.contracts.ENSResolver);

    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deployer.signer, config.multisig.autosign);

    // Deploy the updated ENSManager
    const ENSManagerNew = await deployer.deploy(ENSManager, {}, domain, utils.namehash(domain), config.ENS.ensRegistry, config.contracts.ENSResolver);
    const ENSManagerAddManagerTx = await ENSManagerNew.contract.addManager(config.contracts.WalletFactory);
    await ENSManagerNew.verboseWaitForTransaction(ENSManagerAddManagerTx, 'Set the WalletFactory as the manager of the ENS Manager');

    await multisigExecutor.executeCall(WalletFactoryWrapper, "changeENSManager", [ENSManagerNew.contractAddress]);
    console.log(`ENSManager on WalletFactory changed from old ENSManager to ${ENSManagerNew.contractAddress}...`)

    const ChangeENSManagerOwnerTx = await ENSManagerNew.contract.changeOwner(config.contracts.MultiSigWallet);
    await ENSManagerNew.verboseWaitForTransaction(ChangeENSManagerOwnerTx, `Set the MultiSig as the owner of ENSManager`);

    await multisigExecutor.executeCall(ENSManagerWrapper, "changeRootnodeOwner", ["0x0000000000000000000000000000000000000000"]);
    console.log(`Owner of ${domain} changed from from old ENSManager to 0x0000000000000000000000000000000000000000`);
    
    await multisigExecutor.executeCall(ENSResolverWrapper, "addManager", [ENSManagerNew.contractAddress]);

    configurator.updateInfrastructureAddresses({
        ENSManager: ENSManagerNew.contractAddress
    });
    await configurator.save();

    await Promise.all([
        abiUploader.upload(ENSManagerNew, "contracts")
    ]);
}


module.exports = {
    deploy
};