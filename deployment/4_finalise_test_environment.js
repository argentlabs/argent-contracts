/* global artifacts */

const ENS = artifacts.require("ENSRegistryWithFallback");
const ENSReverseRegistrar = artifacts.require("ReverseRegistrar");

const utils = require("../utils/utilities.js");
const DeployManager = require("../utils/deploy-manager.js");

const BYTES32_NULL = "0x0000000000000000000000000000000000000000000000000000000000000000";

async function deployENSReverseRegistrar(config, owner, overrides) {
  const ENSRegistryWrapper = await ENS.at(config.ENS.ensRegistry);
  const ENSReverseRegistrarWrapper = await ENSReverseRegistrar.new(config.ENS.ensRegistry, config.contracts.ENSResolver);

  console.log("Create the reverse namespace");
  await ENSRegistryWrapper.setSubnodeOwner(BYTES32_NULL, utils.sha3("reverse"), owner, overrides);

  console.log("Create the addr.reverse namespace and make the ENS reverse registrar the owner");
  await ENSRegistryWrapper.setSubnodeOwner(
    utils.namehash("reverse"),
    utils.sha3("addr"),
    ENSReverseRegistrarWrapper.address,
    overrides,
  );
}

module.exports = async (callback) => {
  // //////////////////////////////////
  // Setup
  // //////////////////////////////////
  const idx = process.argv.indexOf("--network");
  const network = idx > -1 ? process.argv[idx + 1] : "development";
  console.log(`## ${network} network ##`);

  // TODO: Maybe get the signer account a better way?
  const accounts = await web3.eth.getAccounts();
  const deploymentAccount = accounts[0];

  const manager = new DeployManager(network, deploymentAccount);
  await manager.setup();

  const { configurator } = manager;
  const { config } = configurator;

  if (config.ENS.deployOwnRegistry) {
    await deployENSReverseRegistrar(config, deploymentAccount);
  }

  callback();
};
