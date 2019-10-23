// AWS_PROFILE=argent-test AWS_SDK_LOAD_CONFIG=true etherlime deploy --file ./scripts/deploy_custom_upgrader.js --compile false

const ModuleRegistry = require('../build/ModuleRegistry');
const MultiSig = require('../build/MultiSigWallet');
const Upgrader = require('../build/SimpleUpgrader');

const utils = require('../utils/utilities.js');
const DeployManager = require('../utils/deploy-manager.js');
const MultisigExecutor = require('../utils/multisigexecutor.js');


async function deploy() { 

    const network = 'test';
    const modules_to_remove = [];
    const modules_to_add = ["0x624EbBd0f4169E2e11861618045491b6A4e29E77", "0xF6E1AB6cA27c995433C6b71E15270F0b11AE38E2", "0xeAD317AAeAecE3048338D158A64012378bE0bcE2", "0xE739e93dD617D28216dB669AcFdbFC70BF95663c"];
    const upgrader_name = "0x4ef2f261_0xee7263da"; 

    const manager = new DeployManager(network);
	await manager.setup();

	const configurator = manager.configurator;
	const deployer = manager.deployer;
    const deploymentWallet = deployer.signer;
    const config = configurator.config;

    const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
    const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

    const UpgraderWrapper = await deployer.deploy(
        Upgrader,
        {},
        modules_to_remove,
        modules_to_add
    );

    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerUpgrader", [UpgraderWrapper.contractAddress, utils.asciiToBytes32(upgrader_name)]);

}

module.exports = {
	deploy
};