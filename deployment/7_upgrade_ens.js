const ENSManager = require('../build/ENSManager');
const WalletFactory = require('../build/WalletFactory');

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

    // Deploy the updated ENSManager
    const ENSManagerNew = await deployer.deploy(ENSManager, {}, domain, utils.namehash(domain), config.ENS.ensRegistry, config.contracts.ENSResolver);

    const ENSManagerAddManagerTx = await ENSManagerNew.contract.addManager(config.contracts.WalletFactory);
    await ENSManagerNew.verboseWaitForTransaction(ENSManagerAddManagerTx, 'Set the WalletFactory as the manager of the ENS Manager');

    const WalletFactoryChangeENSManagerTx = await WalletFactoryWrapper.contract.changeENSManager(ENSManagerNew.contractAddress);
    await WalletFactoryWrapper.verboseWaitForTransaction(WalletFactoryChangeENSManagerTx, `Change the ENSManager on the WalletFactory`);

    const ChangeENSManagerOwnerTx = await ENSManagerNew.contract.changeOwner(config.contracts.MultiSigWallet);
    await ENSManagerNew.verboseWaitForTransaction(ChangeENSManagerOwnerTx, `Set the MultiSig as the owner of ENSManager}`);

    const ChangeDomainOwnerTx = await ENSManagerWrapper.contract.changeRootnodeOwner("0x0000000000000000000000000000000000000000");
    await ENSManagerWrapper.verboseWaitForTransaction(ChangeDomainOwnerTx, `Throw away domain ownership in the old ENSRegistry to avoid legacy updates`);

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