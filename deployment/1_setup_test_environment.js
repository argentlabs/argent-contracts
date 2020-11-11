/* global artifacts */

const ENSRegistry = artifacts.require("ENSRegistry");
const ENSRegistryWithFallback = artifacts.require("ENSRegistryWithFallback");
const UniswapFactory = artifacts.require("../lib/uniswap/UniswapFactory");
const UniswapExchange = artifacts.require("../lib/uniswap/UniswapExchange");
const MakerMigration = artifacts.require("MockScdMcdMigration");

// Paraswap
const AugustusSwapper = artifacts.require("AugustusSwapper");
const Whitelisted = artifacts.require("Whitelisted");
const PartnerRegistry = artifacts.require("PartnerRegistry");
const PartnerDeployer = artifacts.require("PartnerDeployer");
const KyberAdapter = artifacts.require("Kyber");

const utils = require("../utils/utilities.js");
const DeployManager = require("../utils/deploy-manager.js");

const BYTES32_NULL = "0x0000000000000000000000000000000000000000000000000000000000000000";

// For development purpose
async function deployENSRegistry(deployer, owner, domain) {
  const { gasPrice } = deployer.defaultOverrides;
  // Deploy the public ENS registry
  const ensRegistryWithoutFallback = await deployer.deploy(ENSRegistry);
  const ENSWrapper = await deployer.deploy(ENSRegistryWithFallback, {}, ensRegistryWithoutFallback.contractAddress);

  // ENS domain
  const parts = domain.split(".");
  const extension = parts[1];
  const domainName = parts[0];

  // Create the 'eth' and 'xyz' namespaces
  const setSubnodeOwnerXYZ = await ENSWrapper.contract.setSubnodeOwner(BYTES32_NULL, utils.sha3(extension), owner, { gasPrice });
  await ENSWrapper.verboseWaitForTransaction(setSubnodeOwnerXYZ, `Setting Subnode Owner for ${extension}`);

  // Create the 'argentx.xyz' wallet ENS namespace
  const setSubnodeOwnerArgent = await ENSWrapper.contract.setSubnodeOwner(utils.namehash(extension), utils.sha3(domainName), owner, { gasPrice });
  await ENSWrapper.verboseWaitForTransaction(setSubnodeOwnerArgent, `Setting Subnode Owner for ${domainName}.${extension}`);

  return ENSWrapper.contractAddress;
}

async function deployParaswap(deployer) {
  const deploymentAccount = await deployer.signer.getAddress();
  const whitelist = await deployer.deploy(Whitelisted);
  const partnerDeployer = await deployer.deploy(PartnerDeployer);
  const partnerRegistry = await deployer.deploy(PartnerRegistry, {}, partnerDeployer.contractAddress);
  const paraswap = await deployer.deploy(
    AugustusSwapper,
    {},
    whitelist.contractAddress,
    deploymentAccount,
    partnerRegistry.contractAddress,
    deploymentAccount,
    deploymentAccount,
  );
  const kyberAdapter = await deployer.deploy(KyberAdapter, {}, deploymentAccount);
  await whitelist.addWhitelisted(kyberAdapter.contractAddress);
  return { paraswap: paraswap.contractAddress, kyberAdapter: kyberAdapter.contractAddress };
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
    // on some testnets, we use our own ENSRegistry
    const address = await deployENSRegistry(deployer, deploymentAccount, config.ENS.domain);
    configurator.updateENSRegistry(address);
  }

  if (config.defi.paraswap.deployOwn) {
    const { paraswap, kyberAdapter } = await deployParaswap(deployer);
    configurator.updateParaswap(paraswap, { Kyber: kyberAdapter });
  }

  if (config.defi.uniswap.deployOwn) {
    const UniswapFactoryWrapper = await deployer.deploy(UniswapFactory);
    configurator.updateUniswapFactory(UniswapFactoryWrapper.contractAddress);
    const UniswapExchangeTemplateWrapper = await deployer.deploy(UniswapExchange);
    const initializeFactoryTx = await UniswapFactoryWrapper.contract.initializeFactory(UniswapExchangeTemplateWrapper.contractAddress, { gasPrice });
    await UniswapFactoryWrapper.verboseWaitForTransaction(initializeFactoryTx, "Initializing UniswapFactory");
  }

  if (config.defi.maker.deployOwn) {
    // Deploy Maker's mock Migration contract if needed
    const MakerMigrationWrapper = await deployer.deploy(
      MakerMigration,
      {},
      config.defi.maker.vat || "0x0000000000000000000000000000000000000000",
      config.defi.maker.daiJoin || "0x0000000000000000000000000000000000000000",
      config.defi.maker.wethJoin || "0x0000000000000000000000000000000000000000",
      config.defi.maker.tub || "0x0000000000000000000000000000000000000000",
      config.defi.maker.cdpManager || "0x0000000000000000000000000000000000000000",
    );
    configurator.updateMakerMigration(MakerMigrationWrapper.contractAddress);
  }

  // save configuration
  await configurator.save();
};

module.exports = {
  deploy,
};
