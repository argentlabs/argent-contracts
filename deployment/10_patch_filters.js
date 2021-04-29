/* global artifacts */
global.web3 = web3;
global.artifacts = artifacts;

const ethers = require("ethers");
const childProcess = require("child_process");

const DappRegistry = artifacts.require("DappRegistry");
const MultiSig = artifacts.require("MultiSigWallet");

const CompoundFilter = artifacts.require("CompoundCTokenFilter");
const ParaswapFilter = artifacts.require("ParaswapFilter");
const UniswapV2Filter = artifacts.require("UniswapV2UniZapFilter");
const WethFilter = artifacts.require("WethFilter");
const ParaswapUniV2RouterFilter = artifacts.require("ParaswapUniV2RouterFilter");
const TokenRegistry = artifacts.require("TokenRegistry");

const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const main = async () => {
  const { deploymentAccount, configurator } = await deployManager.getProps();

  // //////////////////////////////////
  // Setup
  // //////////////////////////////////

  const { config } = configurator;
  const DappRegistryWrapper = await DappRegistry.at(config.contracts.DappRegistry);
  const TokenRegistryWrapper = await TokenRegistry.at(config.contracts.TokenRegistry);
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  // //////////////////////////////////
  // Change DappREgistry ownership
  // //////////////////////////////////

  console.log("Setting the deployment account as the owner of default registry");
  await multisigExecutor.executeCall(DappRegistryWrapper, "changeOwner", [0, deploymentAccount]);

  // //////////////////////////////////
  // Update existing filters to Argent Registry
  // //////////////////////////////////

  const filters = { ...config.filters };

  //
  // Compound
  //
  for (const [underlying, cToken] of Object.entries(config.defi.compound.markets)) {
    if (underlying === "0x89d24A6b4CcB1B6fAA2625fE562bDD9a23260359" || underlying === "0x1985365e9f78359a9B6AD760e32412f4a445E862") {
      // remove SAI and REP filter
      console.log(`Removing filter for Compound Underlying ${underlying}`);
      await DappRegistryWrapper.removeDapp(0, cToken);
    } else if (underlying === "0xdAC17F958D2ee523a2206206994597C13D831ec7" || underlying === "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984") {
      // add USDT and UNI filter
      console.log(`Deploying filter for Compound Underlying ${underlying}`);
      const CompoundFilterWrapper = await CompoundFilter.new(underlying);
      console.log(`Deployed filter for Compound Underlying ${underlying} at ${CompoundFilterWrapper.address}`);
      filters.CompoundFilter.push(CompoundFilterWrapper.address);
      console.log(`Adding filter for Compound Underlying ${underlying}`);
      await DappRegistryWrapper.addDapp(0, cToken, CompoundFilterWrapper.address);
    }
  }

  //
  // WETH
  //
  console.log("Deploying WethFilter");
  const WethFilterWrapper = await WethFilter.new();
  console.log(`Deployed WethFilter at ${WethFilterWrapper.address}`);
  filters.WethFilter = WethFilterWrapper.address;
  await DappRegistryWrapper.addDapp(0, config.defi.weth, WethFilterWrapper.address);

  //
  // Uniswap V2
  //
  console.log("Deploying UniswapV2Filter");
  const UniswapV2FilterWrapper = await UniswapV2Filter.new(
    TokenRegistryWrapper.address,
    config.defi.uniswap.factoryV2,
    config.defi.uniswap.initCodeV2,
    config.defi.weth,
  );
  console.log(`Deployed UniswapV2Filter at ${UniswapV2FilterWrapper.address}`);
  filters.UniswapV2UniZapFilter = UniswapV2FilterWrapper.address;
  await DappRegistryWrapper.requestFilterUpdate(0, config.defi.uniswap.unizap, UniswapV2FilterWrapper.address);

  //
  // Paraswap
  //
  console.log("Deploying ParaswapFilter");
  const ParaswapFilterWrapper = await ParaswapFilter.new(
    TokenRegistryWrapper.address,
    DappRegistryWrapper.address,
    config.defi.paraswap.contract,
    config.defi.paraswap.uniswapProxy,
    config.defi.paraswap.uniswapForks.map((f) => f.factory),
    config.defi.paraswap.uniswapForks.map((f) => f.initCode),
    [
      config.defi.paraswap.adapters.uniswap || ethers.constants.AddressZero,
      config.defi.paraswap.adapters.uniswapV2 || ethers.constants.AddressZero,
      config.defi.paraswap.adapters.sushiswap || ethers.constants.AddressZero,
      config.defi.paraswap.adapters.linkswap || ethers.constants.AddressZero,
      config.defi.paraswap.adapters.defiswap || ethers.constants.AddressZero,
      config.defi.paraswap.adapters.zeroexV2 || ethers.constants.AddressZero,
      config.defi.paraswap.adapters.zeroexV4 || ethers.constants.AddressZero,
      config.defi.paraswap.adapters.curve || ethers.constants.AddressZero,
      config.defi.paraswap.adapters.weth || ethers.constants.AddressZero,
    ],
    [].concat(...Object.values(config.defi.paraswap.targetExchanges || {})), // flattened targetExchanges values
    config.defi.paraswap.marketMakers || [],
  );
  console.log(`Deployed ParaswapFilter at ${ParaswapFilterWrapper.address}`);
  filters.ParaswapFilter = ParaswapFilterWrapper.address;
  await DappRegistryWrapper.requestFilterUpdate(0, config.defi.paraswap.contract, ParaswapFilterWrapper.address);

  console.log("Deploying ParaswapUniV2RouterFilter");
  const ParaswapUniV2RouterFilterWrapper = await ParaswapUniV2RouterFilter.new(
    TokenRegistryWrapper.address,
    config.defi.uniswap.factoryV2,
    config.defi.uniswap.initCodeV2,
    config.defi.weth
  );
  console.log(`Deployed ParaswapUniV2RouterFilter at ${ParaswapUniV2RouterFilterWrapper.address}`);
  filters.ParaswapUniV2RouterFilter.push(ParaswapUniV2RouterFilterWrapper.address);
  await DappRegistryWrapper.requestFilterUpdate(0, config.defi.uniswap.paraswapUniV2Router, ParaswapUniV2RouterFilterWrapper.address);

  // //////////////////////////////////
  // Change DappREgistry ownership
  // //////////////////////////////////

  console.log("Setting the MultiSig as the owner of default registry");
  await DappRegistryWrapper.changeOwner(0, config.contracts.MultiSigWallet);

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////

  configurator.updateFilterAddresses(filters);

  const gitHash = childProcess.execSync("git rev-parse HEAD").toString("utf8").replace(/\n$/, "");
  configurator.updateGitHash(gitHash);

  console.log("Saving new config");
  await configurator.save();
};

// For truffle exec
module.exports = (cb) => main().then(cb).catch(cb);
