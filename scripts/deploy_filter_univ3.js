// Usage: AWS_PROFILE=argent-test AWS_SDK_LOAD_CONFIG=true npx truffle exec ./scripts/deploy_filter_univ3.js --network test --force

/* global artifacts */
global.web3 = web3;
global.artifacts = artifacts;

const ethers = require("ethers");
const BN = require("bn.js");

const DappRegistry = artifacts.require("DappRegistry");
const MultiSig = artifacts.require("MultiSigWallet");

const ParaswapFilter = artifacts.require("ParaswapFilter");
const UniswapV3RouterFilter = artifacts.require("UniswapV3RouterFilter");

const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const main = async () => {
  const { deploymentAccount, configurator } = await deployManager.getProps();

  // //////////////////////////////////
  // Setup
  // //////////////////////////////////

  const { config } = configurator;
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);
  const DappRegistryWrapper = await DappRegistry.at(config.contracts.DappRegistry);

  const idx = process.argv.indexOf("--force");
  const force = (idx !== -1);

  const installFilter = async ({ filterDeployer, dapp, dappName = "Dapp", filterName = "Filter", registryId = 0 }) => {
    const timelock = 1000 * parseInt((await DappRegistryWrapper.timelockPeriod()).toString(16), 16);
    const { filter } = await DappRegistryWrapper.getAuthorisation(registryId, dapp);
    const [filterStr, dappStr] = [`${filterName}@${filter}`, `${dappName}@${dapp}`];
    if (filter === ethers.constants.AddressZero) {
      const newFilter = await filterDeployer();
      console.log(`Adding ${filterName}@${newFilter} for ${dappStr}`);
      await multisigExecutor.executeCall(DappRegistryWrapper, "addDapp", [registryId, dapp, newFilter]);
      console.log(`Done. Filter will be active on ${(new Date(Date.now() + timelock)).toLocaleString()}\n`);
    } else {
      const pendingUpdate = await DappRegistryWrapper.pendingFilterUpdates(registryId, dapp);
      const pendingUpdateConfirmationTime = 1000 * parseInt(new BN(pendingUpdate.slice(2), 16).maskn(64).toString(16), 16);
      const pendingUpdateFilterAddress = `0x${pendingUpdate.slice(10, 50)}`;
      if (pendingUpdate === ethers.constants.HashZero) {
        if (force) {
          const newFilter = await filterDeployer();
          console.log(`Requesting replacement of ${filterStr} by ${filterName}@${newFilter} for ${dappStr}`);
          await multisigExecutor.executeCall(DappRegistryWrapper, "requestFilterUpdate", [registryId, dapp, newFilter]);
          console.log(
            `Done. Pending filter update will be confirmable on ${new Date(Date.now() + timelock).toLocaleString()}\n`
          );
        } else {
          console.log(`Existing filter ${filterStr} found for ${dappStr}. Use --force to request its replacement\n`);
        }
      } else if (Date.now() < pendingUpdateConfirmationTime) {
        const confTime = new Date(pendingUpdateConfirmationTime).toLocaleString();
        console.log(
          `Pending installation of ${filterName}@${pendingUpdateFilterAddress} for ${dappStr} will be confirmable on ${confTime}\n`
        );
      } else {
        console.log(`Confirming installation of ${filterName}@${pendingUpdateFilterAddress} for ${dappStr}`);
        await multisigExecutor.executeCall(DappRegistryWrapper, "confirmFilterUpdate", [registryId, dapp]);
        console.log("Done.\n");
      }
    }
  };

  const getFilterFromConfigOrDeployNew = async (filterArtifact, params = []) => {
    const { contractName } = filterArtifact._json;
    if (!config.filters || !config.filters[contractName] || config.filters[contractName] === ethers.constants.AddressZero) {
      console.log(`Deploying ${contractName}`);
      const wrapper = await filterArtifact.new(...params);
      console.log(`Deployed ${contractName} at ${wrapper.address}\n`);
      configurator.updateFilterAddresses({ [contractName]: wrapper.address });
      await configurator.save();
      return wrapper.address;
    }
    return config.filters[contractName];
  };

  // //////////////////////////////////
  // Deploy and add filters to Argent Registry
  // //////////////////////////////////

  // Paraswap
  await installFilter({
    filterDeployer: async () => {
      console.log("Deploying ParaswapFilter");
      const ParaswapFilterWrapper = await ParaswapFilter.new(
        config.contracts.TokenRegistry,
        config.contracts.DappRegistry,
        config.defi.paraswap.contract,
        config.defi.paraswap.uniswapProxy,
        [...config.defi.paraswap.uniswapForks.map((f) => f.factory), config.defi.uniswap.factoryV3],
        [...config.defi.paraswap.uniswapForks.map((f) => f.initCode), config.defi.uniswap.initCodeV3],
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
          config.defi.paraswap.adapters.uniswapV3 || ethers.constants.AddressZero,
        ],
        [].concat(...Object.values(config.defi.paraswap.targetExchanges || {})), // flattened targetExchanges values
        config.defi.paraswap.marketMakers || [],
      );
      console.log(`Deployed ParaswapFilter at ${ParaswapFilterWrapper.address}`);
      configurator.updateFilterAddresses({ ParaswapFilter: ParaswapFilterWrapper.address });
      await configurator.save();
      return ParaswapFilterWrapper.address;
    },
    dapp: config.defi.paraswap.contract,
    dappName: "Augustus",
    filterName: "ParaswapFilter"
  });

  // UniswapV3RouterFilter
  await installFilter({
    filterDeployer: async () => getFilterFromConfigOrDeployNew(UniswapV3RouterFilter, [
      config.contracts.TokenRegistry,
      config.defi.uniswap.factoryV3,
      config.defi.uniswap.initCodeV3,
      config.defi.weth
    ]),
    dapp: config.defi.uniswap.v3Router,
    dappName: "UniswapV3RouterFilter",
    filterName: "UniswapV3RouterFilter"
  });
};

// For truffle exec
module.exports = (cb) => main().then(cb).catch(cb);
