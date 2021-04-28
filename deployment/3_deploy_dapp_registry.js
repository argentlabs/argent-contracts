/* global artifacts */
global.web3 = web3;
global.artifacts = artifacts;

const ethers = require("ethers");
const childProcess = require("child_process");

const DappRegistry = artifacts.require("DappRegistry");
const MultiSig = artifacts.require("MultiSigWallet");
const MultiCallHelper = artifacts.require("MultiCallHelper");

const CompoundFilter = artifacts.require("CompoundCTokenFilter");
const IAugustusSwapper = artifacts.require("IAugustusSwapper");
const ParaswapFilter = artifacts.require("ParaswapFilter");
const ParaswapUniV2RouterFilter = artifacts.require("ParaswapUniV2RouterFilter");
const WhitelistedZeroExV2Filter = artifacts.require("WhitelistedZeroExV2Filter");
const WhitelistedZeroExV4Filter = artifacts.require("WhitelistedZeroExV4Filter");
const OnlyApproveFilter = artifacts.require("OnlyApproveFilter");
const WethFilter = artifacts.require("WethFilter");
const AaveV2Filter = artifacts.require("AaveV2Filter");
const BalancerFilter = artifacts.require("BalancerFilter");
const YearnFilter = artifacts.require("YearnFilter");
const PotFilter = artifacts.require("PotFilter");
const DaiJoinFilter = artifacts.require("DaiJoinFilter");
const VatFilter = artifacts.require("VatFilter");
const ScdMcdMigration = artifacts.require("ScdMcdMigration");
const UniswapV2Filter = artifacts.require("UniswapV2UniZapFilter");
const LidoFilter = artifacts.require("LidoFilter");
const CurveFilter = artifacts.require("CurveFilter");
const AaveV1LendingPoolFilter = artifacts.require("AaveV1LendingPoolFilter");
const AaveV1ATokenFilter = artifacts.require("AaveV1ATokenFilter");

const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const main = async () => {
  const { deploymentAccount, configurator, abiUploader, network } = await deployManager.getProps();

  // //////////////////////////////////
  // Setup
  // //////////////////////////////////

  const { config } = configurator;

  // //////////////////////////////////
  // Deploy infrastructure
  // //////////////////////////////////

  // Deploy DappRegistry (initial timelock of 0 to enable immediate addition to Argent Registry)
  const DappRegistryWrapper = await DappRegistry.new(0);
  console.log("Deployed DappRegistry at ", DappRegistryWrapper.address);

  // Deploy MultiCall Helper
  const MultiCallHelperWrapper = await MultiCallHelper.new(config.modules.TransferStorage, DappRegistryWrapper.address);
  console.log("Deployed MultiCallHelper at ", MultiCallHelperWrapper.address);

  // //////////////////////////////////
  // Deploy and add filters to Argent Registry
  // //////////////////////////////////

  // refund collector
  await DappRegistryWrapper.addDapp(0, config.backend.refundCollector, ethers.constants.AddressZero);
  if (config.backend.tradeCommissionCollector !== config.backend.refundCollector) {
    await DappRegistryWrapper.addDapp(0, config.backend.tradeCommissionCollector, ethers.constants.AddressZero);
  }

  const filters = {};

  // Compound
  filters.CompoundFilter = [];
  for (const [underlying, cToken] of Object.entries(config.defi.compound.markets)) {
    console.log(`Deploying filter for Compound Underlying ${underlying}`);
    const CompoundFilterWrapper = await CompoundFilter.new(underlying);
    console.log(`Deployed filter for Compound Underlying ${underlying} at ${CompoundFilterWrapper.address}`);
    filters.CompoundFilter.push(CompoundFilterWrapper.address);
    console.log(`Adding filter for Compound Underlying ${underlying}`);
    await DappRegistryWrapper.addDapp(0, cToken, CompoundFilterWrapper.address);
  }

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
  await DappRegistryWrapper.addDapp(0, config.defi.paraswap.contract, ParaswapFilterWrapper.address);

  console.log("Deploying ParaswapUniV2RouterFilter");
  const factories = [config.defi.uniswap.factoryV2, ...config.defi.paraswap.uniswapForks.map((f) => f.factory)];
  const initCodes = [config.defi.uniswap.initCodeV2, ...config.defi.paraswap.uniswapForks.map((f) => f.initCode)];
  const routers = [config.defi.uniswap.paraswapUniV2Router, ...config.defi.paraswap.uniswapForks.map((f) => f.paraswapUniV2Router)];
  filters.ParaswapUniV2RouterFilter = [];
  for (let i = 0; i < routers.length; i += 1) {
    const ParaswapUniV2RouterFilterWrapper = await ParaswapUniV2RouterFilter.new(
      TokenRegistryWrapper.address,
      factories[i],
      initCodes[i],
      config.defi.weth
    );
    console.log(`Deployed ParaswapUniV2RouterFilter #${i} at ${ParaswapUniV2RouterFilterWrapper.address}`);
    filters.ParaswapUniV2RouterFilter.push(ParaswapUniV2RouterFilterWrapper.address);
    await DappRegistryWrapper.addDapp(0, routers[i], ParaswapUniV2RouterFilterWrapper.address);
  }

  // Paraswap Proxies
  console.log("Deploying OnlyApproveFilter");
  const OnlyApproveFilterWrapper = await OnlyApproveFilter.new();
  console.log(`Deployed OnlyApproveFilter at ${OnlyApproveFilterWrapper.address}`);
  filters.OnlyApproveFilter = OnlyApproveFilterWrapper.address;
  const AugustusSwapperWrapper = await IAugustusSwapper.at(config.defi.paraswap.contract);
  const proxies = [await AugustusSwapperWrapper.getTokenTransferProxy(), ...Object.values(config.defi.paraswap.proxies || {})];
  for (const proxy of proxies) {
    console.log(`Adding OnlyApproveFilter for proxy ${proxy}`);
    await DappRegistryWrapper.addDapp(0, proxy, OnlyApproveFilterWrapper.address);
  }

  // Paraswap ZeroEx filters
  if (config.defi.paraswap.targetExchanges.zeroexv2) {
    console.log("Deploying WhitelistedZeroExV2Filter");
    const WhitelistedZeroExV2FilterWrapper = await WhitelistedZeroExV2Filter.new(config.defi.paraswap.marketMakers);
    console.log(`Deployed WhitelistedZeroExV2Filter at ${WhitelistedZeroExV2FilterWrapper.address}`);
    filters.WhitelistedZeroExV2Filter = WhitelistedZeroExV2FilterWrapper.address;
    await DappRegistryWrapper.addDapp(0, config.defi.paraswap.targetExchanges.zeroexv2, WhitelistedZeroExV2FilterWrapper.address);
  }
  if (config.defi.paraswap.targetExchanges.zeroexv4) {
    console.log("Deploying WhitelistedZeroExV4Filter");
    const WhitelistedZeroExV4FilterWrapper = await WhitelistedZeroExV4Filter.new(config.defi.paraswap.marketMakers);
    console.log(`Deployed WhitelistedZeroExV4Filter at ${WhitelistedZeroExV4FilterWrapper.address}`);
    filters.WhitelistedZeroExV4Filter = WhitelistedZeroExV4FilterWrapper.address;
    await DappRegistryWrapper.addDapp(0, config.defi.paraswap.targetExchanges.zeroexv4, WhitelistedZeroExV4FilterWrapper.address);
  }

  // Curve filters
  console.log("Deploying CurveFilter");
  const CurveFilterWrapper = await CurveFilter.new();
  console.log(`Deployed CurveFilter at ${CurveFilterWrapper.address}`);
  filters.CurveFilter = CurveFilterWrapper.address;
  for (const pool of config.defi.paraswap.targetExchanges.curve || []) {
    console.log(`Adding CurveFilter for pool ${pool}`);
    await DappRegistryWrapper.addDapp(0, pool, CurveFilterWrapper.address);
  }

  // WETH filter
  console.log("Deploying WethFilter");
  const WethFilterWrapper = await WethFilter.new();
  console.log(`Deployed WethFilter at ${WethFilterWrapper.address}`);
  filters.WethFilter = WethFilterWrapper.address;
  await DappRegistryWrapper.addDapp(0, config.defi.weth, WethFilterWrapper.address);

  // The following filters can't be setup on Ropsten due to tha lack of integrations
  if (network !== "test") {
    // AaveV2
    console.log("Deploying AaveV2Filter");
    const AaveV2FilterWrapper = await AaveV2Filter.new();
    console.log(`Deployed AaveV2Filter at ${AaveV2FilterWrapper.address}`);
    filters.AaveV2Filter = AaveV2FilterWrapper.address;
    await DappRegistryWrapper.addDapp(0, config.defi.aave.contract, AaveV2FilterWrapper.address);

    // Balancer
    console.log("Deploying BalancerFilter");
    const BalancerFilterWrapper = await BalancerFilter.new();
    console.log(`Deployed BalancerFilter at ${BalancerFilterWrapper.address}`);
    filters.BalancerFilter = BalancerFilterWrapper.address;
    for (const pool of (config.defi.balancer.pools)) {
      console.log(`Adding filter for Balancer pool ${pool}`);
      await DappRegistryWrapper.addDapp(0, pool, BalancerFilterWrapper.address);
    }

    // yEarn
    filters.YearnFilter = [];
    console.log("Deploying YearnFilter (isWeth=false)");
    const YearnFilterWrapper = await YearnFilter.new(false);
    console.log(`Deployed YearnFilter (isWeth=false) at ${YearnFilterWrapper.address}`);
    filters.YearnFilter.push(YearnFilterWrapper.address);
    console.log("Deploying YearnFilter (isWeth=true)");
    const WethYearnFilterWrapper = await YearnFilter.new(true);
    console.log(`Deployed YearnFilter (isWeth=true) at ${WethYearnFilterWrapper.address}`);
    filters.YearnFilter.push(WethYearnFilterWrapper.address);
    for (const pool of (config.defi.yearn.pools)) {
      console.log(`Adding filter for Yearn pool ${pool}`);
      await DappRegistryWrapper.addDapp(0, pool, YearnFilterWrapper.address);
    }
    for (const pool of (config.defi.yearn.wethPools)) {
      console.log(`Adding filter for WETH Yearn pool ${pool}`);
      await DappRegistryWrapper.addDapp(0, pool, WethYearnFilterWrapper.address);
    }

    // Lido
    console.log("Deploying LidoFilter");
    const LidoFilterWrapper = await LidoFilter.new();
    console.log(`Deployed LidoFilter at ${LidoFilterWrapper.address}`);
    filters.LidoFilter = LidoFilterWrapper.address;
    await DappRegistryWrapper.addDapp(0, config.defi.lido.contract, LidoFilterWrapper.address);
    // Note: The filter for the stETH -> ETH curve Pool was deployed in the Curve section
  }

  // DSR
  console.log("Deploying PotFilter");
  const PotFilterWrapper = await PotFilter.new();
  console.log(`Deployed PotFilter at ${PotFilterWrapper.address}`);
  filters.PotFilter = PotFilterWrapper.address;
  await DappRegistryWrapper.addDapp(0, config.defi.maker.pot, PotFilterWrapper.address);

  console.log("Deploying DaiJoinFilter");
  const DaiJoinFilterWrapper = await DaiJoinFilter.new();
  console.log(`Deployed DaiJoinFilter at ${DaiJoinFilterWrapper.address}`);
  filters.DaiJoinFilter = DaiJoinFilterWrapper.address;
  const migration = await ScdMcdMigration.at(config.defi.maker.migration);
  const daiJoin = await migration.daiJoin();
  await DappRegistryWrapper.addDapp(0, daiJoin, DaiJoinFilterWrapper.address);

  console.log("Deploying VatFilter");
  const vat = await migration.vat();
  const VatFilterWrapper = await VatFilter.new(daiJoin, config.defi.maker.pot);
  console.log(`Deployed VatFilter at ${VatFilterWrapper.address}`);
  filters.VatFilter = VatFilterWrapper.address;
  await DappRegistryWrapper.addDapp(0, vat, VatFilterWrapper.address);

  // Uniswap V2
  console.log("Deploying UniswapV2Filter");
  const UniswapV2FilterWrapper = await UniswapV2Filter.new(
    TokenRegistryWrapper.address,
    config.defi.uniswap.factoryV2,
    config.defi.uniswap.initCodeV2,
    config.defi.weth
  );
  console.log(`Deployed UniswapV2Filter at ${UniswapV2FilterWrapper.address}`);
  filters.UniswapV2UniZapFilter = UniswapV2FilterWrapper.address;
  await DappRegistryWrapper.addDapp(0, config.defi.uniswap.unizap, UniswapV2FilterWrapper.address);

  // Aave V1
  console.log("Deploying AaveV1");

  const AaveV1LendingPoolFilterWrapper = await AaveV1LendingPoolFilter.new();
  console.log(`Deployed AaveV1LendingPoolFilter at ${AaveV1LendingPoolFilterWrapper.address}`);
  filters.AaveV1LendingPoolFilter = AaveV1LendingPoolFilterWrapper.address;
  await DappRegistryWrapper.addDapp(0, config.defi.aave.lendingPool, AaveV1LendingPoolFilterWrapper.address);
  console.log("Adding OnlyApproveFilter for AavelendingPoolCore");
  await DappRegistryWrapper.addDapp(0, config.defi.aave.lendingPoolCore, OnlyApproveFilterWrapper.address);

  const AaveV1ATokenFilterWrapper = await AaveV1ATokenFilter.new();
  console.log(`Deployed AaveV1ATokenFilter at ${AaveV1ATokenFilterWrapper.address}`);
  filters.AaveV1ATokenFilter = AaveV1ATokenFilterWrapper.address;
  for (const aToken of (config.defi.aave.aTokens)) {
    console.log(`Adding filter for Aave token ${aToken}`);
    await DappRegistryWrapper.addDapp(0, aToken, AaveV1ATokenFilterWrapper.address);
  }

  // //////////////////////////////////
  // Setup DappRegistry
  // //////////////////////////////////

  // Setting timelock
  console.log(`Setting Timelock to ${config.settings.timelockPeriod}`);
  await DappRegistryWrapper.requestTimelockChange(config.settings.timelockPeriod);
  await DappRegistryWrapper.confirmTimelockChange();
  console.log("Timelock changed.");
  // Setting ownership
  console.log("Setting the MultiSig as the owner of default registry");
  await DappRegistryWrapper.changeOwner(0, config.contracts.MultiSigWallet);

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////

  configurator.updateInfrastructureAddresses({
    DappRegistry: DappRegistryWrapper.address,
    MultiCallHelper: MultiCallHelperWrapper.address,
  });

  configurator.updateFilterAddresses(filters);

  const gitHash = childProcess.execSync("git rev-parse HEAD").toString("utf8").replace(/\n$/, "");
  configurator.updateGitHash(gitHash);

  console.log("Saving new config");
  await configurator.save();

  console.log("Uploading ABIs");
  await Promise.all([
    abiUploader.upload(DappRegistryWrapper, "contracts"),
    abiUploader.upload(MultiCallHelperWrapper, "contracts"),
  ]);
};

// For truffle exec
module.exports = (cb) => main().then(cb).catch(cb);
