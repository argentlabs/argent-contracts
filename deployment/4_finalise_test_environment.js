/* global artifacts */

const ENS = artifacts.require("ENSRegistryWithFallback");
const ENSReverseRegistrar = artifacts.require("ReverseRegistrar");

const utils = require("../utils/utilities.js");
const DeployManager = require("../utils/deploy-manager.js");

const BYTES32_NULL = "0x0000000000000000000000000000000000000000000000000000000000000000";

async function deployENSReverseRegistrar(deployer, config, owner, overrides) {
  const ENSRegistryWrapper = deployer.wrapDeployedContract(ENS, config.ENS.ensRegistry);
  const ENSReverseRegistrarWrapper = await ENSReverseRegistrar.new(config.ENS.ensRegistry, config.contracts.ENSResolver);

  const setSubnodeOwnerTx1 = await ENSRegistryWrapper.contract.setSubnodeOwner(BYTES32_NULL, utils.sha3("reverse"), owner, overrides);
  await ENSRegistryWrapper.verboseWaitForTransaction(setSubnodeOwnerTx1, "Create the reverse namespace");

  const setSubnodeOwnerTx2 = await ENSRegistryWrapper.contract.setSubnodeOwner(
    utils.namehash("reverse"),
    utils.sha3("addr"),
    ENSReverseRegistrarWrapper.address,
    overrides,
  );
  await ENSRegistryWrapper.verboseWaitForTransaction(setSubnodeOwnerTx2,
    "Create the addr.reverse namespace and make the ENS reverse registrar the owner");
}

const deploy = async (network) => {
  const manager = new DeployManager(network);
  await manager.setup();

  const { configurator } = manager;
  const { deployer } = manager;
  const { gasPrice } = deployer.defaultOverrides;

  const { config } = configurator;

  const deploymentAccount = await deployer.signer.getAddress();

  if (config.ENS.deployOwnRegistry) {
    await deployENSReverseRegistrar(deployer, config, deploymentAccount, { gasPrice });
  }
};

module.exports = {
  deploy,
};
