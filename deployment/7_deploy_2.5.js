/* global artifacts */
global.web3 = web3;

const semver = require("semver");
const childProcess = require("child_process");

const MultiSig = artifacts.require("MultiSigWallet");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const ArgentModule = artifacts.require("ArgentModule");
const BaseWallet = artifacts.require("BaseWallet");
const WalletFactory = artifacts.require("WalletFactory");
const DappRegistry = artifacts.require("DappRegistry");
const Upgrader = artifacts.require("SimpleUpgrader");

const CompoundFilter = artifacts.require("CompoundCTokenFilter");
const IAugustusSwapper = artifacts.require("IAugustusSwapper");
const ParaswapFilter = artifacts.require("ParaswapFilter");
const OnlyApproveFilter = artifacts.require("OnlyApproveFilter");
const AaveV2Filter = artifacts.require("AaveV2Filter");
const BalancerFilter = artifacts.require("BalancerFilter");
const YearnFilter = artifacts.require("YearnFilter");

const deployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const utils = require("../utils/utilities.js");

const TARGET_VERSION = "2.5.0";
const MODULES_TO_ENABLE = [
  "ArgentModule",
];
const MODULES_TO_DISABLE = [
  "VersionManager",
  "MakerV2Manager",
  "TokenExchanger",
  "LockManager",
  "RecoveryManager",
  "TransferManager",
  "NftTransfer",
  "RelayerManager",
  "CompoundManager",
  "GuardianManager",
  "ApprovedTransfer",
  "UniswapManager",
  "MakerManager",
  "DappManager",
  "ModuleManager",
  "TokenTransfer"
];

const BACKWARD_COMPATIBILITY = 5;

const main = async () => {
  const { deploymentAccount, configurator, versionUploader, abiUploader } = await deployManager.getProps();

  const newModuleWrappers = [];
  const newVersion = {};

  // //////////////////////////////////
  // Setup
  // //////////////////////////////////

  const { config } = configurator;

  const ModuleRegistryWrapper = await ModuleRegistry.at(config.contracts.ModuleRegistry);
  const MultiSigWrapper = await MultiSig.at(config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentAccount, config.multisig.autosign);

  // //////////////////////////////////
  // Deploy infrastructure
  // //////////////////////////////////

  // Deploy new BaseWallet
  const BaseWalletWrapper = await BaseWallet.new();
  console.log("Deployed BaseWallet at ", BaseWalletWrapper.address);

  // Deploy the Wallet Factory
  const WalletFactoryWrapper = await WalletFactory.new(
    BaseWalletWrapper.address, config.modules.GuardianStorage, config.backend.refundCollector
  );
  console.log("Deployed WalletFactory at ", WalletFactoryWrapper.address);

  // Deploy DappRegistry (initial timelock of 0 to enable immediate addition to Argent Registry)
  const DappRegistryWrapper = await DappRegistry.new(0);
  console.log("Deployed DappRegistry at ", DappRegistryWrapper.address);

  // //////////////////////////////////
  // Deploy and add filters to Argent Registry
  // //////////////////////////////////

  // Compound
  for (const [underlying, cToken] of Object.entries(config.defi.compound.markets)) {
    console.log(`Deploying filter for Compound Underlying ${underlying}`);
    const CompoundFilterWrapper = await CompoundFilter.new(underlying);
    console.log(`Deployed filter for Compound Underlying ${underlying} at ${CompoundFilterWrapper.address}`);
    console.log(`Adding filter for Compound Underlying ${underlying}`);
    await DappRegistryWrapper.addDapp(0, cToken, CompoundFilterWrapper.address);
  }

  // Paraswap
  console.log("Deploying ParaswapFilter");
  const ParaswapFilterWrapper = await ParaswapFilter.new(config.modules.TokenPriceRegistry, config.contracts.DexRegistry);
  console.log(`Deployed ParaswapFilter at ${ParaswapFilterWrapper.address}`);
  await DappRegistryWrapper.addDapp(0, config.defi.paraswap.contract, ParaswapFilterWrapper.address);

  // Paraswap Proxy
  console.log("Deploying OnlyApproveFilter");
  const OnlyApproveFilterWrapper = await OnlyApproveFilter.new();
  console.log(`Deployed OnlyApproveFilter at ${OnlyApproveFilterWrapper.address}`);
  const AugustusSwapperWrapper = await IAugustusSwapper.at(config.defi.paraswap.contract);
  await DappRegistryWrapper.addDapp(0, await AugustusSwapperWrapper.getTokenTransferProxy(), OnlyApproveFilterWrapper.address);

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

  // Setting timelock
  console.log(`Setting Timelock to ${config.settings.timelockPeriod}`);
  await DappRegistryWrapper.requestTimelockChange(config.settings.timelockPeriod);
  await DappRegistryWrapper.confirmTimelockChange();
  console.log("Timelock changed.");

  // //////////////////////////////////
  // Deploy modules
  // //////////////////////////////////

  console.log("Deploying modules");

  // Deploy ArgentModule
  const ArgentModuleWrapper = await ArgentModule.new(
    config.contracts.ModuleRegistry,
    config.modules.GuardianStorage,
    config.modules.TransferStorage,
    DappRegistryWrapper.address,
    config.defi.uniswap.v2Router,
    config.settings.securityPeriod || 0,
    config.settings.securityWindow || 0,
    config.settings.recoveryPeriod || 0,
    config.settings.lockPeriod || 0);

  newModuleWrappers.push(ArgentModuleWrapper);

  // //////////////////////////////////
  // Set contracts' managers
  // //////////////////////////////////

  for (const idx in config.backend.accounts) {
    const account = config.backend.accounts[idx];
    console.log(`Setting ${account} as the manager of the WalletFactory`);
    await WalletFactoryWrapper.addManager(account);
  }

  // //////////////////////////////////
  // Set contracts' owners
  // //////////////////////////////////

  console.log("Setting the MultiSig as the owner of WalletFactoryWrapper");
  await WalletFactoryWrapper.changeOwner(config.contracts.MultiSigWallet);

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////

  configurator.updateModuleAddresses({
    ArgentModule: ArgentModuleWrapper.address,
  });

  configurator.updateInfrastructureAddresses({
    WalletFactory: WalletFactoryWrapper.address,
    BaseWallet: BaseWalletWrapper.address,
    DappRegistry: DappRegistryWrapper.address,
  });

  const gitHash = childProcess.execSync("git rev-parse HEAD").toString("utf8").replace(/\n$/, "");
  configurator.updateGitHash(gitHash);

  console.log("Saving new config");
  await configurator.save();

  console.log("Uploading ABIs");
  await Promise.all([
    abiUploader.upload(ArgentModuleWrapper, "modules"),
    abiUploader.upload(WalletFactoryWrapper, "contracts"),
    abiUploader.upload(BaseWalletWrapper, "contracts"),
    abiUploader.upload(DappRegistryWrapper, "contracts"),
  ]);

  // //////////////////////////////////
  // Register new modules
  // //////////////////////////////////

  for (let idx = 0; idx < newModuleWrappers.length; idx += 1) {
    const wrapper = newModuleWrappers[idx];
    console.log(`Registering module ${wrapper.constructor.contractName}`);
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule",
      [wrapper.address, utils.asciiToBytes32(wrapper.constructor.contractName)]);
  }

  // //////////////////////////////////
  // Deploy and Register upgraders
  // //////////////////////////////////

  let fingerprint;
  console.log(`Loading last ${BACKWARD_COMPATIBILITY} versions`);
  const versions = await versionUploader.load(BACKWARD_COMPATIBILITY);
  for (let idx = 0; idx < versions.length; idx += 1) {
    const version = versions[idx];
    let toAdd; let toRemove;
    if (idx === 0) {
      const moduleNamesToRemove = MODULES_TO_DISABLE.concat(MODULES_TO_ENABLE);
      toRemove = version.modules.filter((module) => moduleNamesToRemove.includes(module.name));
      toAdd = newModuleWrappers.map((wrapper) => ({
        address: wrapper.address,
        name: wrapper.constructor.contractName,
      }));
      const toKeep = version.modules.filter((module) => !moduleNamesToRemove.includes(module.name));
      const modulesInNewVersion = toKeep.concat(toAdd);
      fingerprint = utils.versionFingerprint(modulesInNewVersion);
      newVersion.version = semver.lt(version.version, TARGET_VERSION) ? TARGET_VERSION : semver.inc(version.version, "patch");
      newVersion.createdAt = Math.floor((new Date()).getTime() / 1000);
      newVersion.modules = modulesInNewVersion;
      newVersion.fingerprint = fingerprint;
    } else {
      // add all modules present in newVersion that are not present in version
      toAdd = newVersion.modules.filter((module) => !version.modules.map((m) => m.address).includes(module.address));
      // remove all modules from version that are no longer present in newVersion
      toRemove = version.modules.filter((module) => !newVersion.modules.map((m) => m.address).includes(module.address));
    }

    const upgraderName = `${version.fingerprint}_${fingerprint}`;

    console.log(`Deploying upgrader ${upgraderName}`);
    const UpgraderWrapper = await Upgrader.new(
      config.contracts.ModuleRegistry,
      toRemove.map((module) => module.address),
      toAdd.map((module) => module.address)
    );

    console.log(`Registering ${upgraderName} as a module`);
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerModule",
      [UpgraderWrapper.address, utils.asciiToBytes32(upgraderName)]);

    console.log(`Registering ${upgraderName} as an upgrader`);
    await multisigExecutor.executeCall(ModuleRegistryWrapper, "registerUpgrader",
      [UpgraderWrapper.address, utils.asciiToBytes32(upgraderName)]);
  }

  // //////////////////////////////////
  // Upload Version
  // //////////////////////////////////

  await versionUploader.upload(newVersion);
};

// For truffle exec
module.exports = (cb) => main().then(cb).catch(cb);
