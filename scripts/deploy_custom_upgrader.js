// AWS_PROFILE=argent-test AWS_SDK_LOAD_CONFIG=true npx truffle exec ./scripts/deploy_custom_upgrader.js

/* global artifacts */
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

  const modulesToRemove = [];
  const modulesToAdd = [
    "0x624EbBd0f4169E2e11861618045491b6A4e29E77",
    "0xF6E1AB6cA27c995433C6b71E15270F0b11AE38E2",
    "0xeAD317AAeAecE3048338D158A64012378bE0bcE2",
    "0xE739e93dD617D28216dB669AcFdbFC70BF95663c",
  ];
  const upgraderName = "0x4ef2f261_0xee7263da";

  const ModuleRegistryWrapper = await ModuleRegistry.at(config.contracts.ModuleRegistry);
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  const UpgraderWrapper = await Upgrader.new(
    modulesToRemove,
    modulesToAdd,
  );

  await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerUpgrader",
    [UpgraderWrapper.address, utils.asciiToBytes32(upgraderName)]);
}

main().catch((err) => {
  throw err;
});
