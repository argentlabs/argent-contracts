/* global artifacts */
global.web3 = web3;
global.artifacts = artifacts;

const ethers = require("ethers");
const childProcess = require("child_process");

const DappRegistry = artifacts.require("DappRegistry");

const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const main = async () => {
  const { configurator } = await deployManager.getProps();

  // //////////////////////////////////
  // Setup
  // //////////////////////////////////

  const { config } = configurator;
  const DappRegistryWrapper = await DappRegistry.at(config.contracts.DappRegistry);

  // //////////////////////////////////
  // Update existing filters to Argent Registry
  // //////////////////////////////////

  console.log(`Confirming filter for ${config.defi.uniswap.unizap}`);
  await DappRegistryWrapper.confirmFilterUpdate(0, config.defi.uniswap.unizap);
  console.log(`Confirming filter for ${config.defi.paraswap.contract}`);
  await DappRegistryWrapper.confirmFilterUpdate(0, config.defi.paraswap.contract);
  console.log(`Confirming filter for ${config.defi.uniswap.paraswapUniV2Router}`);
  await DappRegistryWrapper.confirmFilterUpdate(0, config.defi.uniswap.paraswapUniV2Router);

};

// For truffle exec
module.exports = (cb) => main().then(cb).catch(cb);
