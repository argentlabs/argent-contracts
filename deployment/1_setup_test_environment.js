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
async function deployENSRegistry(owner, domain) {
  // Deploy the public ENS registry
  const ensRegistryWithoutFallback = await ENSRegistry.new();
  const ENSWrapper = await ENSRegistryWithFallback.new(ensRegistryWithoutFallback.address);

  // ENS domain
  const parts = domain.split(".");
  const extension = parts[1];
  const domainName = parts[0];

  // Create the 'eth' and 'xyz' namespaces
  console.log(`Setting Subnode Owner for ${extension}`);
  await ENSWrapper.setSubnodeOwner(BYTES32_NULL, utils.sha3(extension), owner);

  // Create the 'argentx.xyz' wallet ENS namespace
  console.log(`Setting Subnode Owner for ${domainName}.${extension}`);
  await ENSWrapper.setSubnodeOwner(utils.namehash(extension), utils.sha3(domainName), owner);

  return ENSWrapper.address;
}

async function deployParaswap(deploymentAccount) {
  const whitelist = await Whitelisted.new();
  const partnerDeployer = await PartnerDeployer.new();
  const partnerRegistry = await PartnerRegistry.new(partnerDeployer.address);
  const paraswap = await AugustusSwapper.new(
    whitelist.address,
    deploymentAccount,
    partnerRegistry.address,
    deploymentAccount,
    deploymentAccount,
  );
  const kyberAdapter = await KyberAdapter.new(deploymentAccount);
  await whitelist.addWhitelisted(kyberAdapter.address);
  return { paraswap: paraswap.address, kyberAdapter: kyberAdapter.address };
}

module.exports = async (callback) => {
  // TODO: Maybe get the signer account a better way?
  const accounts = await web3.eth.getAccounts();
  const deploymentAccount = accounts[0];

  const manager = new DeployManager(deploymentAccount);
  await manager.setup();
  const { configurator } = manager;
  const { config } = configurator;

  if (config.ENS.deployOwnRegistry) {
    // on some testnets, we use our own ENSRegistry
    const address = await deployENSRegistry(deploymentAccount, config.ENS.domain);
    configurator.updateENSRegistry(address);
  }

  if (config.defi.paraswap.deployOwn) {
    const { paraswap, kyberAdapter } = await deployParaswap(deploymentAccount);
    configurator.updateParaswap(paraswap, { Kyber: kyberAdapter });
  }

  if (config.defi.uniswap.deployOwn) {
    const UniswapFactoryWrapper = await UniswapFactory.new();
    configurator.updateUniswapFactory(UniswapFactoryWrapper.address);
    const UniswapExchangeTemplateWrapper = await UniswapExchange.new();
    await UniswapFactoryWrapper.initializeFactory(UniswapExchangeTemplateWrapper.address);
  }

  if (config.defi.maker.deployOwn) {
    // Deploy Maker's mock Migration contract if needed
    const MakerMigrationWrapper = await MakerMigration.new(
      config.defi.maker.vat || "0x0000000000000000000000000000000000000000",
      config.defi.maker.daiJoin || "0x0000000000000000000000000000000000000000",
      config.defi.maker.wethJoin || "0x0000000000000000000000000000000000000000",
      config.defi.maker.tub || "0x0000000000000000000000000000000000000000",
      config.defi.maker.cdpManager || "0x0000000000000000000000000000000000000000",
    );
    configurator.updateMakerMigration(MakerMigrationWrapper.address);
  }

  // save configuration
  await configurator.save();
  callback();
};
