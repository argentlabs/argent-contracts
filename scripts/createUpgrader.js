// Example Usage:
// node scripts/createUpgrader.js --network fuse.dev --toAdd 0xc93B5C20EDF555f1170e6A285bE9d0B8a6e26355  --toRemove 0x8527a2d3d5aC0411933d663b4dcE275a5b7f39D8 --name UpgraderName

const ModuleRegistry = require('../build/ModuleRegistry');
const MultiSigWallet = require('../build/MultiSigWallet');
const Upgrader = require('../build/SimpleUpgrader');

const MultisigExecutor = require('../utils/multisigexecutor.js');
const DeployManager = require('../utils/deploy-manager.js');
const utils = require('../utils/utilities.js');

async function main() {
    // Read Command Line Arguments
    let idx = process.argv.indexOf("--network");
    const network = process.argv[idx + 1];

    const deployManager = new DeployManager(network);
    await deployManager.setup();

    const configurator = deployManager.configurator;
    const deployer = deployManager.deployer;
    const manager = deployer.signer;
    const versionUploader = manager.versionUploader;

    idx = process.argv.indexOf("--toAdd");
    const toAdd = idx > -1 ? process.argv[idx + 1].split(',') : []

    idx = process.argv.indexOf("--toRemove");
    const toRemove = idx > -1 ? process.argv[idx + 1].split(',') : []

    idx = process.argv.indexOf("--name");
    const upgraderName = idx > -1 ? process.argv[idx + 1] : ''

    const config = configurator.config;
    console.log('Config:', config);

    const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
    const multisigWrapper = await deployer.wrapDeployedContract(MultiSigWallet, config.contracts.MultiSigWallet);
    const multisigExecutor = new MultisigExecutor(multisigWrapper, manager, config.multisig.autosign);

    console.log("Creating Upgrader contract...");

    try {
        const UpgraderWrapper = await deployer.deploy(
          Upgrader,
          {},
          config.contracts.ModuleRegistry,
          toRemove,
          toAdd
      );

      await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule", [UpgraderWrapper.contractAddress, utils.asciiToBytes32(upgraderName)]);
      await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerUpgrader", [UpgraderWrapper.contractAddress, utils.asciiToBytes32(upgraderName)]);

    } catch (e) {
        console.log(e)
    }
}

main().catch(err => {
    console.error(err)
    throw err;
});
