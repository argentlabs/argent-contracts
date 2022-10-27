/* global artifacts */

global.web3 = web3;
global.artifacts = artifacts;

const ENS = artifacts.require("ENSRegistryWithFallback");
const ENSReverseRegistrar = artifacts.require("ReverseRegistrar");

const utils = require("../utils/utilities.js");
const deployManager = require("../utils/deploy-manager.js");

const BYTES32_NULL = "0x0000000000000000000000000000000000000000000000000000000000000000";

async function deployENSReverseRegistrar(config, owner) {
  const ENSRegistryWrapper = await ENS.at(config.ENS.ensRegistry);
  const ENSReverseRegistrarWrapper = await ENSReverseRegistrar.new(config.ENS.ensRegistry, config.contracts.ENSResolver);

  console.log("Create the reverse namespace");
  await ENSRegistryWrapper.setSubnodeOwner(BYTES32_NULL, utils.sha3("reverse"), owner);

  console.log("Create the addr.reverse namespace and make the ENS reverse registrar the owner");
  await ENSRegistryWrapper.setSubnodeOwner(
    utils.namehash("reverse"),
    utils.sha3("addr"),
    ENSReverseRegistrarWrapper.address);
}

async function main() {
  const { deploymentAccount, configurator } = await deployManager.getProps();
  const { config } = configurator;

  if (config.ENS.deployOwnRegistry) {
    await deployENSReverseRegistrar(config, deploymentAccount);
  }

  console.log("## completed deployment script 3 ##");
}

// For truffle exec
module.exports = function (callback) {
  main().then(() => callback()).catch((err) => callback(err));
};
