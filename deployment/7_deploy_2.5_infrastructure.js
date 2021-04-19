/* global artifacts */
global.web3 = web3;
global.artifacts = artifacts;

const ethers = require("ethers");
const childProcess = require("child_process");

const DappRegistry = artifacts.require("DappRegistry");
const MultiSig = artifacts.require("MultiSigWallet");
const BaseWallet = artifacts.require("BaseWallet");
const WalletFactory = artifacts.require("WalletFactory");
const MultiCallHelper = artifacts.require("MultiCallHelper");
const ArgentWalletDetector = artifacts.require("ArgentWalletDetector");
const Proxy = artifacts.require("Proxy");
const TokenRegistry = artifacts.require("TokenRegistry");

const CompoundFilter = artifacts.require("CompoundCTokenFilter");
const IAugustusSwapper = artifacts.require("IAugustusSwapper");
const ParaswapFilter = artifacts.require("ParaswapFilter");
const ParaswapUniV2RouterFilter = artifacts.require("ParaswapUniV2RouterFilter");
const ZeroExV2Filter = artifacts.require("ZeroExV2Filter");
const ZeroExV4Filter = artifacts.require("ZeroExV4Filter");
const OnlyApproveFilter = artifacts.require("OnlyApproveFilter");
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
  const ArgentWalletDetectorWrapper = await ArgentWalletDetector.at(config.contracts.ArgentWalletDetector);
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  // //////////////////////////////////
  // Deploy infrastructure
  // //////////////////////////////////

  // Deploy new BaseWallet
  const BaseWalletWrapper = await BaseWallet.new();
  console.log("Deployed BaseWallet at ", BaseWalletWrapper.address);

  console.log("Adding wallet code");
  const proxyCode = ethers.utils.keccak256(Proxy.deployedBytecode);
  await multisigExecutor.executeCall(ArgentWalletDetectorWrapper, "addCode", [proxyCode]);
  console.log("Adding wallet implementation");
  await multisigExecutor.executeCall(ArgentWalletDetectorWrapper, "addImplementation", [BaseWalletWrapper.address]);

  // Deploy the Wallet Factory
  const WalletFactoryWrapper = await WalletFactory.new(
    BaseWalletWrapper.address, config.modules.GuardianStorage, config.backend.refundCollector
  );
  console.log("Deployed WalletFactory at ", WalletFactoryWrapper.address);

  // Deploy DappRegistry (initial timelock of 0 to enable immediate addition to Argent Registry)
  const DappRegistryWrapper = await DappRegistry.new(0);
  console.log("Deployed DappRegistry at ", DappRegistryWrapper.address);

  // Deploy MultiCall Helper
  const MultiCallHelperWrapper = await MultiCallHelper.new(config.modules.TransferStorage, DappRegistryWrapper.address);
  console.log("Deployed MultiCallHelper at ", MultiCallHelperWrapper.address);

  // Deploy new TokenRegistry
  const TokenRegistryWrapper = await TokenRegistry.new();
  console.log("Deployed TokenRegistry at ", TokenRegistryWrapper.address);

  // //////////////////////////////////
  // Deploy and add filters to Argent Registry
  // //////////////////////////////////

  // refund collector
  await DappRegistryWrapper.addDapp(0, config.backend.refundCollector, ethers.constants.AddressZero);
  if (network !== "test") {
    // trade commision collector. In Test the refundCollector account is used
    await DappRegistryWrapper.addDapp(0, config.backend.tradeCommissionCollector, ethers.constants.AddressZero);
  }

  // Compound
  for (const [underlying, cToken] of Object.entries(config.defi.compound.markets)) {
    console.log(`Deploying filter for Compound Underlying ${underlying}`);
    const CompoundFilterWrapper = await CompoundFilter.new(underlying);
    console.log(`Deployed filter for Compound Underlying ${underlying} at ${CompoundFilterWrapper.address}`);
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
      config.defi.paraswap.adapters.curve || ethers.constants.AddressZero
    ],
    Object.values(config.defi.paraswap.targetExchanges || {}),
    config.defi.paraswap.marketMakers || [],
  );
  console.log(`Deployed ParaswapFilter at ${ParaswapFilterWrapper.address}`);
  await DappRegistryWrapper.addDapp(0, config.defi.paraswap.contract, ParaswapFilterWrapper.address);

  console.log("Deploying ParaswapUniV2RouterFilter");
  const factories = [config.defi.uniswap.factoryV2, ...config.defi.paraswap.uniswapForks.map((f) => f.factory)];
  const initCodes = [config.defi.uniswap.initCodeV2, ...config.defi.paraswap.uniswapForks.map((f) => f.initCode)];
  const routers = [config.defi.uniswap.paraswapUniV2Router, ...config.defi.paraswap.uniswapForks.map((f) => f.paraswapUniV2Router)];
  for (let i = 0; i < routers.length; i += 1) {
    const ParaswapUniV2RouterFilterWrapper = await ParaswapUniV2RouterFilter.new(
      TokenRegistryWrapper.address,
      factories[i],
      initCodes[i],
      config.defi.weth
    );
    console.log(`Deployed ParaswapUniV2RouterFilter #${i} at ${ParaswapUniV2RouterFilterWrapper.address}`);
    await DappRegistryWrapper.addDapp(0, routers[i], ParaswapUniV2RouterFilterWrapper.address);
  }

  // Paraswap Proxy
  console.log("Deploying OnlyApproveFilter");
  const OnlyApproveFilterWrapper = await OnlyApproveFilter.new();
  console.log(`Deployed OnlyApproveFilter at ${OnlyApproveFilterWrapper.address}`);
  const AugustusSwapperWrapper = await IAugustusSwapper.at(config.defi.paraswap.contract);
  const proxies = [await AugustusSwapperWrapper.getTokenTransferProxy(), ...Object.values(config.defi.paraswap.proxies || {})];
  for (const proxy of proxies) {
    console.log(`Adding OnlyApproveFilter for proxy ${proxy}`);
    await DappRegistryWrapper.addDapp(0, proxy, OnlyApproveFilterWrapper.address);
  }

  // Paraswap ZeroEx filters
  if (config.defi.paraswap.targetExchanges.zeroexv2) {
    console.log("Deploying ZeroExV2Filter");
    const ZeroExV2FilterWrapper = await ZeroExV2Filter.new(config.defi.paraswap.marketMakers);
    console.log(`Deployed ZeroExV2Filter at ${ZeroExV2FilterWrapper.address}`);
    await DappRegistryWrapper.addDapp(0, config.defi.paraswap.targetExchanges.zeroexv2, ZeroExV2FilterWrapper.address);
  }
  if (config.defi.paraswap.targetExchanges.zeroexv4) {
    console.log("Deploying ZeroExV4Filter");
    const ZeroExV4FilterWrapper = await ZeroExV4Filter.new(config.defi.paraswap.marketMakers);
    console.log(`Deployed ZeroExV4Filter at ${ZeroExV4FilterWrapper.address}`);
    await DappRegistryWrapper.addDapp(0, config.defi.paraswap.targetExchanges.zeroexv4, ZeroExV4FilterWrapper.address);
  }

  // The following filters can't be setup on Ropsten due to tha lack of integrations
  if (network !== "test") {
    // AaveV2
    console.log("Deploying AaveV2Filter");
    const AaveV2FilterWrapper = await AaveV2Filter.new();
    console.log(`Deployed AaveV2Filter at ${AaveV2FilterWrapper.address}`);
    await DappRegistryWrapper.addDapp(0, config.defi.aave.contract, AaveV2FilterWrapper.address);

    // Balancer
    console.log("Deploying BalancerFilter");
    const BalancerFilterWrapper = await BalancerFilter.new();
    console.log(`Deployed BalancerFilter at ${BalancerFilterWrapper.address}`);
    for (const pool of (config.defi.balancer.pools)) {
      console.log(`Adding filter for Balancer pool ${pool}`);
      await DappRegistryWrapper.addDapp(0, pool, BalancerFilterWrapper.address);
    }

    // yEarn
    console.log("Deploying YearnFilter (isWeth=false)");
    const YearnFilterWrapper = await YearnFilter.new(false);
    console.log(`Deployed YearnFilter (isWeth=false) at ${YearnFilterWrapper.address}`);
    console.log("Deploying YearnFilter (isWeth=true)");
    const WethYearnFilterWrapper = await YearnFilter.new(true);
    console.log(`Deployed YearnFilter (isWeth=true) at ${WethYearnFilterWrapper.address}`);
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
    await DappRegistryWrapper.addDapp(0, config.defi.lido.contract, LidoFilterWrapper.address);
    // Curve Pool for stETH -> ETH
    console.log("Deploying CurveFilter");
    const CurveFilterWrapper = await CurveFilter.new();
    console.log(`Deployed CurveFilter at ${CurveFilterWrapper.address}`);
    await DappRegistryWrapper.addDapp(0, config.defi.lido.stETHCurvePool, CurveFilterWrapper.address);
  }

  // DSR
  console.log("Deploying PotFilter");
  const PotFilterWrapper = await PotFilter.new();
  console.log(`Deployed PotFilter at ${PotFilterWrapper.address}`);
  await DappRegistryWrapper.addDapp(0, config.defi.maker.pot, PotFilterWrapper.address);

  console.log("Deploying DaiJoinFilter");
  const DaiJoinFilterWrapper = await DaiJoinFilter.new();
  console.log(`Deployed DaiJoinFilter at ${DaiJoinFilterWrapper.address}`);
  const migration = await ScdMcdMigration.at(config.defi.maker.migration);
  const daiJoin = await migration.daiJoin();
  await DappRegistryWrapper.addDapp(0, daiJoin, DaiJoinFilterWrapper.address);

  console.log("Deploying VatFilter");
  const vat = await migration.vat();
  const VatFilterWrapper = await VatFilter.new(daiJoin, config.defi.maker.pot);
  console.log(`Deployed VatFilter at ${VatFilterWrapper.address}`);
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
  await DappRegistryWrapper.addDapp(0, config.defi.uniswap.unizap, UniswapV2FilterWrapper.address);

  // Aave V1
  console.log("Deploying AaveV1");

  const AaveV1LendingPoolFilterWrapper = await AaveV1LendingPoolFilter.new();
  console.log(`Deployed AaveV1LendingPoolFilter at ${AaveV1LendingPoolFilterWrapper.address}`);
  await DappRegistryWrapper.addDapp(0, config.defi.aave.lendingPool, AaveV1LendingPoolFilterWrapper.address);
  console.log("Adding OnlyApproveFilter for AavelendingPoolCore");
  await DappRegistryWrapper.addDapp(0, config.defi.aave.lendingPoolCore, OnlyApproveFilterWrapper.address);

  const AaveV1ATokenFilterWrapper = await AaveV1ATokenFilter.new();
  console.log(`Deployed AaveV1ATokenFilter at ${AaveV1ATokenFilterWrapper.address}`);
  for (const aToken of (config.defi.aave.aTokens)) {
    console.log(`Adding filter for Aave token ${aToken}`);
    await DappRegistryWrapper.addDapp(0, aToken, AaveV1ATokenFilterWrapper.address);
  }

  // Setting timelock
  console.log(`Setting Timelock to ${config.settings.timelockPeriod}`);
  await DappRegistryWrapper.requestTimelockChange(config.settings.timelockPeriod);
  await DappRegistryWrapper.confirmTimelockChange();
  console.log("Timelock changed.");

  // //////////////////////////////////
  // Set contracts' managers
  // //////////////////////////////////

  for (const idx in config.backend.accounts) {
    const account = config.backend.accounts[idx];
    console.log(`Setting ${account} as the manager of the WalletFactory`);
    await WalletFactoryWrapper.addManager(account);
    console.log(`Setting ${account} as the manager of the TokenRegistry`);
    await TokenRegistryWrapper.addManager(account);
  }

  // //////////////////////////////////
  // Set contracts' owners
  // //////////////////////////////////

  console.log("Setting the MultiSig as the owner of WalletFactoryWrapper");
  await WalletFactoryWrapper.changeOwner(config.contracts.MultiSigWallet);

  console.log("Setting the MultiSig as the owner of TokenRegistry");
  await TokenRegistryWrapper.changeOwner(config.contracts.MultiSigWallet);

  console.log("Setting the MultiSig as the owner of default registry");
  await DappRegistryWrapper.changeOwner(0, config.contracts.MultiSigWallet);

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////

  configurator.updateInfrastructureAddresses({
    DappRegistry: DappRegistryWrapper.address,
    WalletFactory: WalletFactoryWrapper.address,
    BaseWallet: BaseWalletWrapper.address,
    MultiCallHelper: MultiCallHelperWrapper.address,
    TokenRegistry: TokenRegistryWrapper.address,
    OnlyApproveFilter: OnlyApproveFilterWrapper.address,
  });

  const gitHash = childProcess.execSync("git rev-parse HEAD").toString("utf8").replace(/\n$/, "");
  configurator.updateGitHash(gitHash);

  console.log("Saving new config");
  await configurator.save();

  console.log("Uploading ABIs");
  await Promise.all([
    abiUploader.upload(DappRegistryWrapper, "contracts"),
    abiUploader.upload(WalletFactoryWrapper, "contracts"),
    abiUploader.upload(BaseWalletWrapper, "contracts"),
    abiUploader.upload(MultiCallHelperWrapper, "contracts"),
    abiUploader.upload(TokenRegistryWrapper, "contracts"),
  ]);
};

// For truffle exec
module.exports = (cb) => main().then(cb).catch(cb);
