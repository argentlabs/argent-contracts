/* eslint max-classes-per-file: ["error", 2] */

const ethers = require("ethers");
const chai = require("chai");
const Table = require("cli-table2");
const tinyreq = require("tinyreq");
const BaseWallet = require("../build/BaseWallet");
const Proxy = require("../build/Proxy");
const ModuleRegistry = require("../build/ModuleRegistry");
const MultiSig = require("../build/MultiSigWallet");
const WalletFactory = require("../build/WalletFactory");

const NewGuardianManager = require("../build/GuardianManager");
const NewTokenExchanger = require("../build/TokenExchanger");
const NewLockManager = require("../build/LockManager");
const NewRecoveryManager = require("../build/RecoveryManager");
const NewApprovedTransfer = require("../build/ApprovedTransfer");
const NewTransferManager = require("../build/TransferManager");
const NewNftTransfer = require("../build/NftTransfer");
const NewCompoundManager = require("../build/CompoundManager");
const NewMakerV2Manager = require("../build/MakerV2Manager");
const RelayerManager = require("../build/RelayerManager");
const VersionManager = require("../build/VersionManager");

const SimpleUpgrader = require("../build/SimpleUpgrader");
const LimitStorage = require("../build/LimitStorage");
const TokenPriceStorage = require("../build/TokenPriceStorage");

const TransferManager = require("../build-legacy/v1.6.0/TransferManager");
const ApprovedTransfer = require("../build-legacy/v1.6.0/ApprovedTransfer");
const GuardianManager = require("../build-legacy/v1.6.0/GuardianManager");
const LockManager = require("../build-legacy/v1.6.0/LockManager");
const NftTransfer = require("../build-legacy/v1.6.0/NftTransfer");
const RecoveryManager = require("../build-legacy/v1.6.0/RecoveryManager");
const TokenExchanger = require("../build-legacy/v1.6.0/TokenExchanger");
const MakerManager = require("../build-legacy/v1.6.0/MakerManager");
const MakerV2Manager = require("../build-legacy/v1.6.0/MakerV2Manager");
const CompoundManager = require("../build-legacy/v1.6.0/CompoundManager");

const DeployManager = require("../utils/deploy-manager");
const TestManager = require("../utils/test-manager");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
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

    this.testManager = new TestManager(this.accounts);

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
    this.WalletFactoryWrapper = await this.deployer.wrapDeployedContract(WalletFactory, config.contracts.WalletFactory);
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
    // Deploy Storage contracts
    const LimitStorageWrapper = await this.deployer.deploy(LimitStorage);
    const TokenPriceStorageWrapper = await this.deployer.deploy(TokenPriceStorage);

    // Create new modules
    const VersionManagerWrapper = await this.deployer.deploy(
      VersionManager,
      {},
      this.config.contracts.ModuleRegistry,
      this.config.modules.GuardianStorage,
    );

    // Create new features
    const newApprovedTransferWrapper = await this.deployer.deploy(
      NewApprovedTransfer,
      {},
      this.config.contracts.ModuleRegistry,
      this.config.modules.GuardianStorage,
      LimitStorageWrapper.contractAddress,
      VersionManagerWrapper.contractAddress,
      this.config.defi.weth,
    );

    const newCompoundManagerWrapper = await this.deployer.deploy(
        NewCompoundManager,
      {},
      this.config.contracts.ModuleRegistry,
      this.config.modules.GuardianStorage,
      this.config.defi.compound.comptroller,
      this.config.contracts.CompoundRegistry,
      VersionManagerWrapper.contractAddress,
    );

    const newGuardianManager = await this.deployer.deploy(
        NewGuardianManager,
      {},
      this.config.contracts.ModuleRegistry,
      this.config.modules.GuardianStorage,
      VersionManagerWrapper.contractAddress,
      this.config.settings.securityPeriod || 0,
      this.config.settings.securityWindow || 0,
    );

    const newLockManagerWrapper = await this.deployer.deploy(
        NewLockManager,
      {},
      this.config.contracts.ModuleRegistry,
      this.config.modules.GuardianStorage,
      VersionManagerWrapper.contractAddress,
      this.config.settings.lockPeriod || 0,
    );

    const newNftTransferWrapper = await this.deployer.deploy(
      NewNftTransfer,
      {},
      this.config.contracts.ModuleRegistry,
      this.config.modules.GuardianStorage,
      TokenPriceStorageWrapper.contractAddress,
      VersionManagerWrapper.contractAddress,
      this.config.CryptoKitties.contract,
    );

    const newRecoveryManagerWrapper = await this.deployer.deploy(
      NewRecoveryManager,
      {},
      this.config.contracts.ModuleRegistry,
      this.config.modules.GuardianStorage,
      VersionManagerWrapper.contractAddress,
      this.config.settings.recoveryPeriod || 0,
      this.config.settings.lockPeriod || 0,
    );

    const newTokenExchangerWrapper = await this.deployer.deploy(
      NewTokenExchanger,
      {},
      this.config.contracts.ModuleRegistry,
      this.config.modules.GuardianStorage,
      TokenPriceStorageWrapper.contractAddress,
      VersionManagerWrapper.contractAddress,
      this.config.defi.paraswap.contract,
      "argent",
      Object.values(this.config.defi.paraswap.authorisedExchanges),
    );

    const newMakerV2ManagerWrapper = await this.deployer.deploy(
      NewMakerV2Manager,
      {},
      this.config.contracts.ModuleRegistry,
      this.config.modules.GuardianStorage,
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
      this.config.contracts.ModuleRegistry,
      this.config.modules.TransferStorage,
      this.config.modules.GuardianStorage,
      LimitStorageWrapper.contractAddress,
      TokenPriceStorageWrapper.contractAddress,
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
      this.config.contracts.ModuleRegistry,
      this.config.modules.GuardianStorage,
      LimitStorageWrapper.contractAddress,
      TokenPriceStorageWrapper.contractAddress,
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
      newTransferManagerWrapper.contractAddress
    ]);

    // Register new modules
    await this.multisigExecutor.executeCall(
      this.ModuleRegistryWrapper,
      "registerModule",
      [VersionManagerWrapper.contractAddress, ethers.utils.formatBytes32String("VersionManagerWrapper")],
    );

    // Create upgrader
    const upgrader = await this.deployer.deploy(
      SimpleUpgrader,
      {},
      this.ModuleRegistryWrapper.contractAddress,
      this.allModules,
      [VersionManagerWrapper.contractAddress],
    );
    await this.multisigExecutor.executeCall(
      this.ModuleRegistryWrapper,
      "registerModule",
      [upgrader.contractAddress, ethers.utils.formatBytes32String("V1toV2")],
    );
    // Upgrade from V1 to V2
    const tx = await this.ApprovedTransferWrapper.from(this.accounts[0]).addModule(this.wallet.contractAddress, upgrader.contractAddress);
    // if(1+1)return
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
