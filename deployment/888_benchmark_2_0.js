/* eslint max-classes-per-file: ["error", 2] */
/* global artifacts */

const ethers = require("ethers");
const chai = require("chai");
const Table = require("cli-table2");
const tinyreq = require("tinyreq");

const BaseWallet = artifacts.require("BaseWallet");
const Proxy = artifacts.require("Proxy");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const MultiSig = artifacts.require("MultiSigWallet");

const NewGuardianManager = artifacts.require("GuardianManager");
const NewTokenExchanger = artifacts.require("TokenExchanger");
const NewLockManager = artifacts.require("LockManager");
const NewRecoveryManager = artifacts.require("RecoveryManager");
const NewApprovedTransfer = artifacts.require("ApprovedTransfer");
const NewTransferManager = artifacts.require("TransferManager");
const NewNftTransfer = artifacts.require("NftTransfer");
const NewCompoundManager = artifacts.require("CompoundManager");
const NewMakerV2Manager = artifacts.require("MakerV2Manager");
const RelayerManager = artifacts.require("RelayerManager");
const VersionManager = artifacts.require("VersionManager");

const UpgraderToVersionManager = artifacts.require("UpgraderToVersionManager");
const LimitStorage = artifacts.require("LimitStorage");
const LockStorage = artifacts.require("LockStorage");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const DexRegistry = artifacts.require("DexRegistry");

const TransferManager = require("../build-legacy/v1.6.0/TransferManager");
const ApprovedTransfer = require("../build-legacy/v1.6.0/ApprovedTransfer");
const GuardianManager = require("../build-legacy/v1.6.0/GuardianManager");
const LockManager = require("../build-legacy/v1.6.0/LockManager");
const NftTransfer = require("../build-legacy/v1.6.0/NftTransfer");
const RecoveryManager = require("../build-legacy/v1.6.0/RecoveryManager");
const TokenExchanger = require("../build-legacy/v1.6.0/TokenExchanger");
const MakerV2Manager = require("../build-legacy/v1.6.0/MakerV2Manager");
const CompoundManager = require("../build-legacy/v1.6.0/CompoundManager");

const DeployManager = require("../utils/deploy-manager");
const RelayManager = require("../utils/relay-manager");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const { sortWalletByAddress } = require("../utils/utilities.js");

const { expect } = chai;

class Logger {
  constructor() {
    this._items = [];
  }

  async loadData() {
    const coinmarketcap = await tinyreq({ url: "https://api.coinmarketcap.com/v2/ticker/1027/" });
    try {
      this._ethusd = JSON.parse(coinmarketcap).data.quotes.USD.price;
    } catch (error) {
      this._ethusd = "500";
    }

    const etherchain = await tinyreq({ url: "https://www.etherchain.org/api/gasPriceOracle" });
    try {
      this._gas_price = JSON.parse(etherchain);
    } catch (error) {
      this._gas_price = JSON.parse('{"safeLow":"3","standard":"5","fast":"10","fastest":"10"}');
    }
  }

  addItem(key, value) {
    this._items.push({ key, value });
  }

  output() {
    const colWidths = [75, 15];
    const head = [`Task [1 ETH = ${this._ethusd} USD]`, "Gas"];
    for (const speed in this._gas_price) {
      const gasPrice = parseInt(this._gas_price[speed], 10);
      head.push(`${speed} (${gasPrice} gwei)`);
      colWidths.push(20);
    }
    const style = { head: [], border: [] };

    const table = new Table({ head, colWidths, style });

    this._items.forEach((item) => {
      const row = [item.key, item.value.toLocaleString()];
      for (const speed in this._gas_price) {
        const gasPrice = parseInt(this._gas_price[speed], 10);
        const price = item.value * gasPrice * 0.000000001 * parseInt(this._ethusd, 10);
        row.push(price.toLocaleString("en-US", { style: "currency", currency: "USD" }));
      }
      table.push(row);
    });
    return table.toString();
  }
}

class Benchmark {
  constructor(network) {
    this.network = network;
    this._logger = new Logger();
  }

  // ///////////////////
  // //// setup ////////
  // ///////////////////

  async setup() {
    const manager = new DeployManager(this.network);
    await manager.setup();

    const { configurator } = manager;

    this.deployer = manager.deployer;
    this.deploymentWallet = this.deployer.signer;
    const { config } = configurator;

    const signers = (await this.deployer.provider.listAccounts()).map((account) => this.deployer.provider.getSigner(account));
    this.signers = [signers[0], ...sortWalletByAddress(signers.slice(1), "_address")];
    this.accounts = this.signers.map((s) => s._address);
    this.config = config;

    this.testManager = new RelayManager(this.accounts);

    this.GuardianManagerWrapper = await this.deployer.wrapDeployedContract(GuardianManager, config.modules.GuardianManager);
    this.LockManagerWrapper = await this.deployer.wrapDeployedContract(LockManager, config.modules.LockManager);
    this.RecoveryManagerWrapper = await this.deployer.wrapDeployedContract(RecoveryManager, config.modules.RecoveryManager);
    this.ApprovedTransferWrapper = await this.deployer.wrapDeployedContract(ApprovedTransfer, config.modules.ApprovedTransfer);
    this.TransferManagerWrapper = await this.deployer.wrapDeployedContract(TransferManager, config.modules.TransferManager);
    this.TokenExchangerWrapper = await this.deployer.wrapDeployedContract(TokenExchanger, config.modules.TokenExchanger);
    this.NftTransferWrapper = await this.deployer.wrapDeployedContract(NftTransfer, config.modules.NftTransfer);
    this.CompoundManagerWrapper = await this.deployer.wrapDeployedContract(CompoundManager, config.modules.CompoundManager);
    this.MakerV2ManagerWrapper = await this.deployer.wrapDeployedContract(MakerV2Manager, config.modules.MakerV2Manager);

    this.ModuleRegistryWrapper = await this.deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
    this.MultiSigWrapper = await this.deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
    this.BaseWalletWrapper = await this.deployer.wrapDeployedContract(BaseWallet, config.contracts.BaseWallet);

    this.multisigExecutor = new MultisigExecutor(this.MultiSigWrapper, this.signers[0], true);
  }

  async setupWallet() {
    this.allModules = [
      this.GuardianManagerWrapper.contractAddress,
      this.LockManagerWrapper.contractAddress,
      this.RecoveryManagerWrapper.contractAddress,
      this.ApprovedTransferWrapper.contractAddress,
      this.TransferManagerWrapper.contractAddress,
      this.TokenExchangerWrapper.contractAddress,
      this.NftTransferWrapper.contractAddress,
      this.CompoundManagerWrapper.contractAddress,
      this.MakerV2ManagerWrapper.contractAddress,
    ];

    const proxy = await this.deployer.deploy(Proxy, {}, this.BaseWalletWrapper.contractAddress);
    this.wallet = this.deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
    this.walletAddress = this.wallet.contractAddress;
    await this.wallet.init(this.accounts[0], this.allModules);

    await this.deploymentWallet.sendTransaction({
      to: this.walletAddress,
      value: ethers.utils.parseEther("1.0"),
    });
  }

  async testUpgradeAllModules() {
    // Deploy Infrastructure contracts
    const LockStorageWrapper = await this.deployer.deploy(LockStorage);
    const LimitStorageWrapper = await this.deployer.deploy(LimitStorage);
    const TokenPriceRegistryWrapper = await this.deployer.deploy(TokenPriceRegistry);
    const DexRegistryWrapper = await this.deployer.deploy(DexRegistry);

    // Create new modules
    const VersionManagerWrapper = await this.deployer.deploy(
      VersionManager,
      {},
      this.config.contracts.ModuleRegistry,
      LockStorageWrapper.contractAddress,
      this.config.modules.GuardianStorage,
      this.config.modules.TransferStorage,
      LimitStorageWrapper.contractAddress,
    );

    // Create new features
    const newApprovedTransferWrapper = await this.deployer.deploy(
      NewApprovedTransfer,
      {},
      LockStorageWrapper.contractAddress,
      this.config.modules.GuardianStorage,
      LimitStorageWrapper.contractAddress,
      VersionManagerWrapper.contractAddress,
      this.config.defi.weth,
    );

    const newCompoundManagerWrapper = await this.deployer.deploy(
      NewCompoundManager,
      {},
      LockStorageWrapper.contractAddress,
      this.config.defi.compound.comptroller,
      this.config.contracts.CompoundRegistry,
      VersionManagerWrapper.contractAddress,
    );

    const newGuardianManager = await this.deployer.deploy(
      NewGuardianManager,
      {},
      LockStorageWrapper.contractAddress,
      this.config.modules.GuardianStorage,
      VersionManagerWrapper.contractAddress,
      this.config.settings.securityPeriod || 0,
      this.config.settings.securityWindow || 0,
    );

    const newLockManagerWrapper = await this.deployer.deploy(
      NewLockManager,
      {},
      LockStorageWrapper.contractAddress,
      this.config.modules.GuardianStorage,
      VersionManagerWrapper.contractAddress,
      this.config.settings.lockPeriod || 0,
    );

    const newNftTransferWrapper = await this.deployer.deploy(
      NewNftTransfer,
      {},
      LockStorageWrapper.contractAddress,
      TokenPriceRegistryWrapper.contractAddress,
      VersionManagerWrapper.contractAddress,
      this.config.CryptoKitties.contract,
    );

    const newRecoveryManagerWrapper = await this.deployer.deploy(
      NewRecoveryManager,
      {},
      LockStorageWrapper.contractAddress,
      this.config.modules.GuardianStorage,
      VersionManagerWrapper.contractAddress,
      this.config.settings.recoveryPeriod || 0,
      this.config.settings.lockPeriod || 0,
    );

    const newTokenExchangerWrapper = await this.deployer.deploy(
      NewTokenExchanger,
      {},
      LockStorageWrapper.contractAddress,
      TokenPriceRegistryWrapper.contractAddress,
      VersionManagerWrapper.contractAddress,
      DexRegistryWrapper.contractAddress,
      this.config.defi.paraswap.contract,
      "argent",
    );

    const newMakerV2ManagerWrapper = await this.deployer.deploy(
      NewMakerV2Manager,
      {},
      LockStorageWrapper.contractAddress,
      this.config.defi.maker.migration,
      this.config.defi.maker.pot,
      this.config.defi.maker.jug,
      this.config.contracts.MakerRegistry,
      this.config.defi.uniswap.factory,
      VersionManagerWrapper.contractAddress,
    );

    const newTransferManagerWrapper = await this.deployer.deploy(
      NewTransferManager,
      {},
      LockStorageWrapper.contractAddress,
      this.config.modules.TransferStorage,
      LimitStorageWrapper.contractAddress,
      TokenPriceRegistryWrapper.contractAddress,
      VersionManagerWrapper.contractAddress,
      this.config.settings.securityPeriod || 0,
      this.config.settings.securityWindow || 0,
      this.config.settings.defaultLimit || "1000000000000000000",
      this.config.defi.weth,
      "0x0000000000000000000000000000000000000000",
    );

    const relayerManagerWrapper = await this.deployer.deploy(
      RelayerManager,
      {},
      LockStorageWrapper.contractAddress,
      this.config.modules.GuardianStorage,
      LimitStorageWrapper.contractAddress,
      TokenPriceRegistryWrapper.contractAddress,
      VersionManagerWrapper.contractAddress,
    );

    // Add Features to Version Manager
    await VersionManagerWrapper.addVersion([
      newGuardianManager.contractAddress,
      newLockManagerWrapper.contractAddress,
      newRecoveryManagerWrapper.contractAddress,
      newApprovedTransferWrapper.contractAddress,
      newTransferManagerWrapper.contractAddress,
      newTokenExchangerWrapper.contractAddress,
      newNftTransferWrapper.contractAddress,
      newCompoundManagerWrapper.contractAddress,
      newMakerV2ManagerWrapper.contractAddress,
      relayerManagerWrapper.contractAddress,
    ], [
      newTransferManagerWrapper.contractAddress,
    ]);

    // Register new modules
    await this.multisigExecutor.executeCall(
      this.ModuleRegistryWrapper,
      "registerModule", [
        VersionManagerWrapper.contractAddress,
        ethers.utils.formatBytes32String("VersionManagerWrapper"),
      ],
    );

    // Create upgrader
    const upgrader = await this.deployer.deploy(
      UpgraderToVersionManager,
      {},
      this.ModuleRegistryWrapper.contractAddress,
      this.config.modules.GuardianStorage,
      this.allModules,
      VersionManagerWrapper.contractAddress,
    );
    await this.multisigExecutor.executeCall(
      this.ModuleRegistryWrapper,
      "registerModule",
      [upgrader.contractAddress, ethers.utils.formatBytes32String("V1toV2")],
    );
    // Upgrade from V1 to V2
    const tx = await this.ApprovedTransferWrapper.from(this.accounts[0]).addModule(this.wallet.contractAddress, upgrader.contractAddress);
    const txReceipt = await this.ApprovedTransferWrapper.verboseWaitForTransaction(tx);

    // Test if the upgrade worked
    const isVMAuthorised = await this.wallet.authorised(VersionManagerWrapper.contractAddress);
    const isUpgraderAuthorised = await this.wallet.authorised(upgrader.contractAddress);
    const numModules = await this.wallet.modules();
    expect(isVMAuthorised).to.be.true; // eslint-disable-line no-unused-expressions
    expect(isUpgraderAuthorised).to.be.false; // eslint-disable-line no-unused-expressions
    expect(numModules.toNumber()).to.eq(1);

    this._logger.addItem("Upgrade all modules on a wallet", txReceipt.gasUsed.toString());
  }

  // ///////////////////
  // /// use cases /////
  // ///////////////////

  async estimateUpgradeWalletAllModules() {
    await this.testUpgradeAllModules();
  }

  // ///////////////////
  // //// utils ////////
  // ///////////////////

  async relay(target, method, params, wallet, signers, estimate = false) {
    const result = await this.testManager.relay(target, method, params, wallet, signers, this.accounts[9], estimate);
    return result;
  }

  async relayEstimate(target, method, params, wallet, signers) {
    const result = await this.relay(target, method, params, wallet, signers, true);
    return result;
  }

  getAllEstimateMethods() {
    let props = [];
    let obj = this;

    do {
      props = props.concat(Object.getOwnPropertyNames(obj));
      obj = Object.getPrototypeOf(obj);
    } while (obj);

    return props.filter((prop) => prop.startsWith("estimateUpgradeWalletAllModules"));
    // return props.filter((prop) => prop.startsWith("estimate"));
  }

  async output() {
    await this._logger.loadData();
    return this._logger.output();
  }
}

const deploy = async (network) => {
  const benchmark = new Benchmark(network);
  await benchmark.setup();
  let methods = benchmark.getAllEstimateMethods();
  const argvMethods = process.argv.filter((x) => x.startsWith("estimate"));
  if (argvMethods.length > 0) {
    methods = methods.filter((method) => argvMethods.indexOf(method) >= 0);
  }

  for (let index = 0; index < methods.length; index += 1) {
    const method = methods[index];
    console.log(`Running ${method}...`);
    await benchmark.setupWallet();
    await benchmark[method]();
  }

  const output = await benchmark.output();
  console.log(output);
};

module.exports = {
  deploy,
};
