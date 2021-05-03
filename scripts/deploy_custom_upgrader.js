// AWS_PROFILE=argent-test AWS_SDK_LOAD_CONFIG=true npx truffle exec ./scripts/deploy_custom_upgrader.js

/* global artifacts */
global.web3 = web3;
global.artifacts = artifacts;

const ModuleRegistry = artifacts.require("ModuleRegistry");
const MultiSig = artifacts.require("MultiSigWallet");
const Upgrader = artifacts.require("SimpleUpgrader");

const utils = require("../utils/utilities.js");
const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

async function main() {
  const { configurator } = await deployManager.getProps();
  const { config } = configurator;
  const accounts = await web3.eth.getAccounts();
  const deploymentAccount = accounts[0];

  const modulesToRemove = ["0x645ba45dbe3c6942c812a46f9ee8115c89b524ec"];
  const modulesToAdd = [];
  const upgraderName = "0xdf98f295_0x33e12ec0";
  const ModuleRegistryWrapper = await ModuleRegistry.at(config.contracts.ModuleRegistry);
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  const UpgraderWrapper = await Upgrader.new(
    ModuleRegistryWrapper.address,
    modulesToRemove,
    modulesToAdd,
    { gas: 800000 }
  );
  console.log("Upgrader deployed at ", UpgraderWrapper.address);

  await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerUpgrader",
    [UpgraderWrapper.address, utils.asciiToBytes32(upgraderName)], { gas: 500000 });

  await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule",
    [UpgraderWrapper.address, utils.asciiToBytes32(upgraderName)], { gas: 500000 });
}

module.exports = (cb) => main().then(cb).catch(cb);
