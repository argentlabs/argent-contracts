/* global artifacts */

global.web3 = web3;

const ENSRegistry = artifacts.require("ENSRegistry");
const ENSRegistryWithFallback = artifacts.require("ENSRegistryWithFallback");
const UniswapFactory = artifacts.require("../lib/uniswap/UniswapFactory");
const UniswapExchange = artifacts.require("../lib/uniswap/UniswapExchange");
const MakerMigration = artifacts.require("MockScdMcdMigration");

// Uniswap V2
const UniswapV2Router01 = artifacts.require("UniswapV2Router01Mock");
const UniswapV2Factory = artifacts.require("UniswapV2FactoryMock");
const UniZap = artifacts.require("UniZap");

// Paraswap
const AugustusSwapper = artifacts.require("AugustusSwapperMock");
const Whitelisted = artifacts.require("Whitelisted");
const PartnerRegistry = artifacts.require("PartnerRegistry");
const PartnerDeployer = artifacts.require("PartnerDeployer");
const Uniswap = artifacts.require("Uniswap");
const UniswapProxy = artifacts.require("UniswapProxy");

const utils = require("../utils/utilities.js");
const deployManager = require("../utils/deploy-manager.js");

const BYTES32_NULL = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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
  const uniswapProxy = await UniswapProxy.new();
  const paraswapWhitelist = await Whitelisted.new();
  const partnerDeployer = await PartnerDeployer.new();
  const partnerRegistry = await PartnerRegistry.new(partnerDeployer.address);
  const paraswap = await AugustusSwapper.new();
  await paraswap.initialize(
    paraswapWhitelist.address,
    ZERO_ADDRESS,
    partnerRegistry.address,
    deploymentAccount,
    uniswapProxy.address,
  );
  const uniAdapter = await Uniswap.new();
  const wlr = await paraswapWhitelist.WHITELISTED_ROLE();
  await paraswapWhitelist.grantRole(wlr, uniAdapter.address);

  return { paraswap: paraswap.address, uniAdapter: uniAdapter.address };
}

async function main() {
  const { configurator, deploymentAccount } = await deployManager.getProps();
  const { config } = configurator;

  if (config.ENS.deployOwnRegistry) {
    // on some testnets, we use our own ENSRegistry
    const address = await deployENSRegistry(deploymentAccount, config.ENS.domain);
    configurator.updateENSRegistry(address);
  }

  if (config.defi.paraswap.deployOwn) {
    const { paraswap, uniAdapter } = await deployParaswap(deploymentAccount);
    configurator.updateParaswap(paraswap, { Uniswap: uniAdapter });
  }

  if (config.defi.uniswap.deployOwn) {
    // uniswap V1
    const UniswapFactoryWrapper = await UniswapFactory.new();
    configurator.updateUniswapFactory(UniswapFactoryWrapper.address);
    const UniswapExchangeTemplateWrapper = await UniswapExchange.new();
    await UniswapFactoryWrapper.initializeFactory(UniswapExchangeTemplateWrapper.address);
    // Uniswap V2
    const UniswapV2FactoryWrapper = await UniswapV2Factory.new(ZERO_ADDRESS);
    const UniswapV2RouterWrapper = await UniswapV2Router01.new(UniswapV2FactoryWrapper.address, ZERO_ADDRESS);
    configurator.updateUniswapV2Router(UniswapV2RouterWrapper.address);
    const UniZapWrapper = await UniZap.new(UniswapV2FactoryWrapper.address, UniswapV2RouterWrapper.address, ZERO_ADDRESS);
    configurator.updateUniswapV2Zap(UniZapWrapper.address);
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

  console.log("## completed deployment script 1 ##");
}

// For truffle exec
module.exports = function (callback) {
  main().then(() => callback()).catch((err) => callback(err));
};
