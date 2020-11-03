const ModuleRegistry = require("../build/ModuleRegistry");
const ENSManager = require("../build/ArgentENSManager");
const ENSResolver = require("../build/ArgentENSResolver");
const WalletFactory = require("../build/WalletFactory");
const TokenPriceRegistry = require("../build/TokenPriceRegistry");
const CompoundRegistry = require("../build/CompoundRegistry");
const DexRegistry = require("../build/DexRegistry");

const DeployManager = require("../utils/deploy-manager.js");

const deploy = async (network) => {
  // //////////////////////////////////
  // Setup
  // //////////////////////////////////

  const manager = new DeployManager(network);
  await manager.setup();

  const { configurator } = manager;
  const { deployer } = manager;
  const { gasPrice } = deployer.defaultOverrides;

  const { config } = configurator;
  console.log("Config:", config);

  const ENSResolverWrapper = await deployer.wrapDeployedContract(ENSResolver, config.contracts.ENSResolver);
  const ENSManagerWrapper = await deployer.wrapDeployedContract(ENSManager, config.contracts.ENSManager);
  const WalletFactoryWrapper = await deployer.wrapDeployedContract(WalletFactory, config.contracts.WalletFactory);
  const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
  const CompoundRegistryWrapper = await deployer.wrapDeployedContract(CompoundRegistry, config.contracts.CompoundRegistry);
  const TokenPriceRegistryWrapper = await deployer.wrapDeployedContract(TokenPriceRegistry, config.modules.TokenPriceRegistry);
  const DexRegistryWrapper = await deployer.wrapDeployedContract(DexRegistry, config.contracts.DexRegistry);

  // Configure DexRegistry
  const authorisedExchanges = Object.values(config.defi.paraswap.authorisedExchanges);
  const DexRegistrySetAuthorisedTx = await DexRegistryWrapper.contract.setAuthorised(
    authorisedExchanges, Array(authorisedExchanges.length).fill(true), { gasPrice },
  );
  await DexRegistryWrapper.verboseWaitForTransaction(DexRegistrySetAuthorisedTx, "Setting up DexRegistry");

  // //////////////////////////////////
  // Set contracts' managers
  // //////////////////////////////////

  const ENSResolverAddManagerTx1 = await ENSResolverWrapper.contract.addManager(config.contracts.ENSManager, { gasPrice });
  await ENSResolverWrapper.verboseWaitForTransaction(ENSResolverAddManagerTx1, "Set the ENS Manager as the manager of the ENS Resolver");

  const ENSResolverAddManagerTx2 = await ENSResolverWrapper.contract.addManager(config.contracts.MultiSigWallet, { gasPrice });
  await ENSResolverWrapper.verboseWaitForTransaction(ENSResolverAddManagerTx2, "Set the Multisig as the manager of the ENS Resolver");

  const ENSManagerAddManagerTx = await ENSManagerWrapper.contract.addManager(config.contracts.WalletFactory, { gasPrice });
  await ENSManagerWrapper.verboseWaitForTransaction(ENSManagerAddManagerTx, "Set the WalletFactory as the manager of the ENS Manager");

  for (const idx in config.backend.accounts) {
    const account = config.backend.accounts[idx];
    const TokenPriceRegistryAddManagerTx = await TokenPriceRegistryWrapper.contract.addManager(account, { gasPrice });
    await TokenPriceRegistryWrapper.verboseWaitForTransaction(TokenPriceRegistryAddManagerTx,
      `Set ${account} as the manager of the TokenPriceRegistry`);
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
    const changeOwnerTx = await wrapper.contract.changeOwner(config.contracts.MultiSigWallet, { gasPrice });
    await wrapper.verboseWaitForTransaction(changeOwnerTx, `Set the MultiSig as the owner of ${wrapper._contract.contractName}`);
  }
};

module.exports = {
  deploy,
};
