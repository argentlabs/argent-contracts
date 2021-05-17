/* global artifacts */
global.web3 = web3;
global.artifacts = artifacts;

const ethers = require("ethers");
const BN = require("bn.js");

const DappRegistry = artifacts.require("DappRegistry");
const MultiSig = artifacts.require("MultiSigWallet");

const CurveFilter = artifacts.require("CurveFilter");

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

  const getFilterFromConfigOrDeployNew = async (filterArtifact) => {
    const { contractName } = filterArtifact._json;
    if (!config.filters[contractName] || config.filters[contractName] === ethers.constants.AddressZero) {
      console.log(`Deploying ${contractName}`);
      const wrapper = await filterArtifact.new();
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

  for (const pool of config.defi.curve.pools) {
    await installFilter({
      filterDeployer: async () => getFilterFromConfigOrDeployNew(CurveFilter),
      dapp: pool,
      dappName: `Curve pool ${pool}`,
      filterName: "CurveFilter"
    });
  }
};

// For truffle exec
module.exports = (cb) => main().then(cb).catch(cb);
