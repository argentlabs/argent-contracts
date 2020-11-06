/* global artifacts */
const ModuleRegistry = artifacts.require("ModuleRegistry");
const ENSManager = artifacts.require("ArgentENSManager");
const ENSResolver = artifacts.require("ArgentENSResolver");
const WalletFactory = artifacts.require("WalletFactory");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const CompoundRegistry = artifacts.require("CompoundRegistry");
const DexRegistry = artifacts.require("DexRegistry");

const DeployManager = require("../utils/deploy-manager.js");

module.exports = async (callback) => {
  // //////////////////////////////////
  // Setup
  // //////////////////////////////////
  const id = process.argv.indexOf("--network");
  const network = id > -1 ? process.argv[id + 1] : "development";
  console.log(`## ${network} network ##`);

  // TODO: Maybe get the signer account a better way?
  const accounts = await web3.eth.getAccounts();
  const deploymentAccount = accounts[0];

  const manager = new DeployManager(network, deploymentAccount);
  await manager.setup();

  const { configurator } = manager;
  const { config } = configurator;
  console.log("Config:", config);

  const ENSResolverWrapper = await ENSResolver.at(config.contracts.ENSResolver);
  const ENSManagerWrapper = await ENSManager.at(config.contracts.ENSManager);
  const WalletFactoryWrapper = await WalletFactory.at(config.contracts.WalletFactory);
  const ModuleRegistryWrapper = await ModuleRegistry.at(config.contracts.ModuleRegistry);
  const CompoundRegistryWrapper = await CompoundRegistry.at(config.contracts.CompoundRegistry);
  const TokenPriceRegistryWrapper = await TokenPriceRegistry.at(config.modules.TokenPriceRegistry);
  const DexRegistryWrapper = await DexRegistry.at(config.contracts.DexRegistry);

  // Configure DexRegistry
  const authorisedExchanges = Object.values(config.defi.paraswap.authorisedExchanges);
  console.log("Setting up DexRegistry");
  await DexRegistryWrapper.setAuthorised(authorisedExchanges, Array(authorisedExchanges.length).fill(true));

  // //////////////////////////////////
  // Set contracts' managers
  // //////////////////////////////////

  console.log("Set the ENS Manager as the manager of the ENS Resolver");
  await ENSResolverWrapper.addManager(config.contracts.ENSManager);

  console.log("Set the Multisig as the manager of the ENS Resolver");
  await ENSResolverWrapper.addManager(config.contracts.MultiSigWallet);

  console.log("Set the WalletFactory as the manager of the ENS Manager");
  await ENSManagerWrapper.addManager(config.contracts.WalletFactory);

  for (const idx in config.backend.accounts) {
    const account = config.backend.accounts[idx];
    console.log(`Set ${account} as the manager of the WalletFactory`);
    await WalletFactoryWrapper.addManager(account);

    console.log(`Set ${account} as the manager of the TokenPriceRegistry`);
    await TokenPriceRegistryWrapper.addManager(account);
  }

  // //////////////////////////////////
  // Set contracts' owners
  // //////////////////////////////////

  const wrappers = [
    ENSResolverWrapper,
    ENSManagerWrapper,
    WalletFactoryWrapper,
    ModuleRegistryWrapper,
    CompoundRegistryWrapper,
    TokenPriceRegistryWrapper,
    DexRegistryWrapper];

  for (let idx = 0; idx < wrappers.length; idx += 1) {
    const wrapper = wrappers[idx];
    console.log(`Set the MultiSig as the owner of ${wrapper._contract.contractName}`);
    await wrapper.changeOwner(config.contracts.MultiSigWallet);
  }
  callback();
};
