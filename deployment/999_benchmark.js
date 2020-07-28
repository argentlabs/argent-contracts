/* eslint max-classes-per-file: ["error", 2] */
/* global artifacts */
const ethers = require("ethers");
const Table = require("cli-table2");
const tinyreq = require("tinyreq");
const { assert } = require("chai");

const BaseWallet = artifacts.require("BaseWallet");
const Proxy = artifacts.require("Proxy");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const MultiSig = artifacts.require("MultiSigWallet");
const WalletFactory = artifacts.require("WalletFactory");

const GuardianManager = artifacts.require("GuardianManager");
const TokenExchanger = artifacts.require("TokenExchanger");
const LockManager = artifacts.require("LockManager");
const RecoveryManager = artifacts.require("RecoveryManager");
const ApprovedTransfer = artifacts.require("ApprovedTransfer");
const TransferManager = artifacts.require("TransferManager");
const NftTransfer = artifacts.require("NftTransfer");
const CompoundManager = artifacts.require("CompoundManager");
const MakerV2Manager = artifacts.require("MakerV2Manager");
const RelayerManager = artifacts.require("RelayerManager");

const VersionManager = require("../build/VersionManager");

const DeployManager = require("../utils/deploy-manager");
const TestManager = require("../utils/test-manager");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const { sortWalletByAddress } = require("../utils/utilities.js");

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

    // Features
    this.GuardianManagerWrapper = await this.deployer.wrapDeployedContract(GuardianManager, config.modules.GuardianManager);
    this.LockManagerWrapper = await this.deployer.wrapDeployedContract(LockManager, config.modules.LockManager);
    this.RecoveryManagerWrapper = await this.deployer.wrapDeployedContract(RecoveryManager, config.modules.RecoveryManager);
    this.ApprovedTransferWrapper = await this.deployer.wrapDeployedContract(ApprovedTransfer, config.modules.ApprovedTransfer);
    this.TransferManagerWrapper = await this.deployer.wrapDeployedContract(TransferManager, config.modules.TransferManager);
    this.TokenExchangerWrapper = await this.deployer.wrapDeployedContract(TokenExchanger, config.modules.TokenExchanger);
    this.NftTransferWrapper = await this.deployer.wrapDeployedContract(NftTransfer, config.modules.NftTransfer);
    this.CompoundManagerWrapper = await this.deployer.wrapDeployedContract(CompoundManager, config.modules.CompoundManager);
    this.MakerV2ManagerWrapper = await this.deployer.wrapDeployedContract(MakerV2Manager, config.modules.MakerV2Manager);
    this.RelayerManagerWrapper = await this.deployer.wrapDeployedContract(RelayerManager, config.modules.RelayerManager);

    // Module
    this.VersionManagerWrapper = await this.deployer.wrapDeployedContract(VersionManager, config.modules.VersionManager);

    this.ModuleRegistryWrapper = await this.deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
    this.MultiSigWrapper = await this.deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
    this.WalletFactoryWrapper = await this.deployer.wrapDeployedContract(WalletFactory, config.contracts.WalletFactory);
    this.BaseWalletWrapper = await this.deployer.wrapDeployedContract(BaseWallet, config.contracts.BaseWallet);

    this.multisigExecutor = new MultisigExecutor(this.MultiSigWrapper, this.signers[0], true);

    this.testManager.setRelayerManager(this.RelayerManagerWrapper);
    // Add new version to Version Manager
    await this.multisigExecutor.executeCall(
      this.VersionManagerWrapper,
      "addVersion", [
        [
          this.GuardianManagerWrapper.contractAddress,
          this.LockManagerWrapper.contractAddress,
          this.RecoveryManagerWrapper.contractAddress,
          this.ApprovedTransferWrapper.contractAddress,
          this.TransferManagerWrapper.contractAddress,
          this.TokenExchangerWrapper.contractAddress,
          this.NftTransferWrapper.contractAddress,
          this.CompoundManagerWrapper.contractAddress,
          this.MakerV2ManagerWrapper.contractAddress,
          this.RelayerManagerWrapper.contractAddress,
        ], [
          this.TransferManagerWrapper.contractAddress,
        ],
      ],
    );
  }

  async setupWallet() {
    const proxy = await this.deployer.deploy(Proxy, {}, this.BaseWalletWrapper.contractAddress);
    this.wallet = this.deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
    this.walletAddress = this.wallet.contractAddress;
    // init the wallet
    await this.wallet.init(this.accounts[0], [this.VersionManagerWrapper.contractAddress]);
    await this.VersionManagerWrapper.upgradeWallet(this.wallet.contractAddress, await this.VersionManagerWrapper.lastVersion());
    // add first guardian
    [, this.firstGuardian] = this.signers;
    await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[1]);
    // send some funds
    await this.deploymentWallet.sendTransaction({
      to: this.walletAddress,
      value: ethers.utils.parseEther("1.0"),
    });
  }

  async testUpgradeAllFeatures() {
    // Create new features
    this.ApprovedTransferWrapper = await this.deployer.deploy(
      ApprovedTransfer,
      {},
      this.config.modules.LockStorage,
      this.config.modules.GuardianStorage,
      this.config.modules.LimitStorage,
      this.config.modules.VersionManager,
      this.config.defi.weth,
    );

    this.CompoundManagerWrapper = await this.deployer.deploy(
      CompoundManager,
      {},
      this.config.modules.LockStorage,
      this.config.defi.compound.comptroller,
      this.config.contracts.CompoundRegistry,
      this.config.modules.VersionManager,
    );

    this.GuardianManagerWrapper = await this.deployer.deploy(
      GuardianManager,
      {},
      this.config.modules.LockStorage,
      this.config.modules.GuardianStorage,
      this.config.modules.VersionManager,
      this.config.settings.securityPeriod || 0,
      this.config.settings.securityWindow || 0,
    );

    this.LockManagerWrapper = await this.deployer.deploy(
      LockManager,
      {},
      this.config.modules.LockStorage,
      this.config.modules.GuardianStorage,
      this.config.modules.VersionManager,
      this.config.settings.lockPeriod || 0,
    );

    this.NftTransferWrapper = await this.deployer.deploy(
      NftTransfer,
      {},
      this.config.modules.LockStorage,
      this.config.modules.TokenPriceRegistry,
      this.config.modules.VersionManager,
      this.config.CryptoKitties.contract,
    );

    this.RecoveryManagerWrapper = await this.deployer.deploy(
      RecoveryManager,
      {},
      this.config.modules.LockStorage,
      this.config.modules.GuardianStorage,
      this.config.modules.VersionManager,
      this.config.settings.recoveryPeriod || 0,
      this.config.settings.lockPeriod || 0,
    );

    this.TokenExchangerWrapper = await this.deployer.deploy(
      TokenExchanger,
      {},
      this.config.modules.LockStorage,
      this.config.modules.TokenPriceRegistry,
      this.config.modules.VersionManager,
      this.config.contracts.DexRegistry,
      this.config.defi.paraswap.contract,
      "argent",
    );

    this.MakerV2ManagerWrapper = await this.deployer.deploy(
      MakerV2Manager,
      {},
      this.config.modules.LockStorage,
      this.config.defi.maker.migration,
      this.config.defi.maker.pot,
      this.config.defi.maker.jug,
      this.config.contracts.MakerRegistry,
      this.config.defi.uniswap.factory,
      this.config.modules.VersionManager,
    );

    this.TransferManagerWrapper = await this.deployer.deploy(
      TransferManager,
      {},
      this.config.modules.LockStorage,
      this.config.modules.TransferStorage,
      this.config.modules.LimitStorage,
      this.config.modules.TokenPriceRegistry,
      this.config.modules.VersionManager,
      this.config.settings.securityPeriod || 0,
      this.config.settings.securityWindow || 0,
      this.config.settings.defaultLimit || "1000000000000000000",
      this.config.defi.weth,
      "0x0000000000000000000000000000000000000000",
    );

    this.RelayerManagerWrapper = await this.deployer.deploy(
      RelayerManager,
      {},
      this.config.modules.LockStorage,
      this.config.modules.GuardianStorage,
      this.config.modules.LimitStorage,
      this.config.modules.TokenPriceRegistry,
      this.config.modules.VersionManager,
    );

    // Add Features to Version Manager
    await this.multisigExecutor.executeCall(
      this.VersionManagerWrapper,
      "addVersion", [
        [
          this.GuardianManagerWrapper.contractAddress,
          this.LockManagerWrapper.contractAddress,
          this.RecoveryManagerWrapper.contractAddress,
          this.ApprovedTransferWrapper.contractAddress,
          this.TransferManagerWrapper.contractAddress,
          this.TokenExchangerWrapper.contractAddress,
          this.NftTransferWrapper.contractAddress,
          this.CompoundManagerWrapper.contractAddress,
          this.MakerV2ManagerWrapper.contractAddress,
          this.RelayerManagerWrapper.contractAddress,
        ], [
          this.TransferManagerWrapper.contractAddress,
        ],
      ],
    );

    // Upgrade a wallet from 2.0 to 2.1
    const fromVersion = await this.VersionManagerWrapper.walletVersions(this.wallet.contractAddress);
    const lastVersion = await this.VersionManagerWrapper.lastVersion();
    const tx = await this.VersionManagerWrapper.from(this.accounts[0]).upgradeWallet(this.wallet.contractAddress, lastVersion);
    const txReceipt = await this.VersionManagerWrapper.verboseWaitForTransaction(tx);
    const toVersion = await this.VersionManagerWrapper.walletVersions(this.wallet.contractAddress);
    assert.equal(fromVersion.toNumber() + 1, toVersion.toNumber(), "Bad Update");
    console.log(`Wallet updated from version ${fromVersion.toString()} to version ${toVersion.toString()}`);

    this._logger.addItem("Upgrade all modules on a wallet", txReceipt.gasUsed.toString());
  }

  // ///////////////////
  // /// use cases /////
  // ///////////////////

  async estimateCreateWalletAllModules() {
    const gasUsed = await this.WalletFactoryWrapper.estimate.createWallet(
      this.accounts[4], this.VersionManagerWrapper.contractAddress, this.accounts[4], 1,
    );
    this._logger.addItem("Create a wallet (all modules)", gasUsed);
  }

  async estimateAddGuardianDirect() {
    let gasUsed = await this.GuardianManagerWrapper.estimate.addGuardian(this.walletAddress, this.accounts[2]);
    this._logger.addItem("Request add guardian (direct)", gasUsed);

    await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[2]);
    await this.testManager.increaseTime(this.config.settings.securityPeriod + this.config.settings.securityWindow / 2);

    gasUsed = await this.GuardianManagerWrapper.estimate.confirmGuardianAddition(this.walletAddress, this.accounts[2]);
    this._logger.addItem("Confirm add guardian (direct)", gasUsed);
  }

  async estimateRevokeGuardianDirect() {
    let gasUsed = await this.GuardianManagerWrapper.estimate.revokeGuardian(this.walletAddress, this.accounts[1]);
    this._logger.addItem("Request revoke guardian (direct)", gasUsed);

    await this.GuardianManagerWrapper.revokeGuardian(this.walletAddress, this.accounts[1]);
    await this.testManager.increaseTime(this.config.settings.securityPeriod + this.config.settings.securityWindow / 2);

    gasUsed = await this.GuardianManagerWrapper.estimate.confirmGuardianRevokation(this.walletAddress, this.accounts[1]);
    this._logger.addItem("Confirm revoke guardian (direct)", gasUsed);
  }

  async estimateAddGuardianRelayed() {
    const gasUsed = await this.relay(
      this.GuardianManagerWrapper,
      "addGuardian",
      [this.walletAddress, this.accounts[2]],
      this.wallet,
      [this.signers[0]],
    );
    this._logger.addItem("Request add guardian (relayed)", gasUsed);
  }

  async estimateRevokeGuardianRelayed() {
    const gasUsed = await this.relay(
      this.GuardianManagerWrapper,
      "revokeGuardian",
      [this.walletAddress, this.accounts[1]],
      this.wallet,
      [this.signers[0]],
    );
    this._logger.addItem("Request revoke guardian (relayed)", gasUsed);
  }

  async estimateLockWalletDirect() {
    const gasUsed = await this.LockManagerWrapper.from(this.firstGuardian).estimate.lock(this.walletAddress);
    this._logger.addItem("Lock wallet (direct)", gasUsed);
  }

  async estimateUnlockWalletDirect() {
    // lock wallet
    await this.LockManagerWrapper.from(this.firstGuardian).lock(this.walletAddress);

    // estimate unlock wallet
    const gasUsed = await this.LockManagerWrapper.from(this.firstGuardian).estimate.unlock(this.walletAddress);
    this._logger.addItem("Unlock wallet (direct)", gasUsed);
  }

  async estimateLockWalletRelayed() {
    // estimate lock wallet
    const gasUsed = await this.relay(
      this.LockManagerWrapper,
      "lock",
      [this.walletAddress],
      this.wallet,
      [this.firstGuardian],
    );
    this._logger.addItem("Lock wallet (relayed)", gasUsed);
  }

  async estimateUnlockWalletRelayed() {
    // lock wallet
    await this.relay(this.LockManagerWrapper, "lock", [this.walletAddress], this.wallet, [this.firstGuardian]);

    // estimate unlock wallet
    const gasUsed = await this.relay(this.LockManagerWrapper, "unlock",
      [this.walletAddress], this.wallet, [this.firstGuardian]);
    this._logger.addItem("Unlock wallet (relayed)", gasUsed);
  }

  async estimateExecuteRecoveryWithOneGuardian() {
    // estimate execute recovery
    const recoveryAddress = this.accounts[3];
    const gasUsed = await this.relay(this.RecoveryManagerWrapper, "executeRecovery",
      [this.walletAddress, recoveryAddress], this.wallet, [this.firstGuardian]);
    this._logger.addItem("Execute recovery", gasUsed);
  }

  async estimateChangeLimitDirect() {
    const gasUsed = await this.TransferManagerWrapper.estimate.changeLimit(this.walletAddress, 4000000);
    this._logger.addItem("Change limit (direct)", gasUsed);
  }

  async estimateChangeLimitRelayed() {
    const gasUsed = await this.relay(this.TransferManagerWrapper, "changeLimit",
      [this.walletAddress, 67000000], this.wallet, [this.signers[0]]);
    this._logger.addItem("Change limit (relayed)", gasUsed);
  }

  async estimateETHTransferNoLimitDirect() {
    // disable limit
    await this.TransferManagerWrapper.disableLimit(this.walletAddress);
    await this.testManager.increaseTime(this.config.settings.securityPeriod + 1);

    // transfer
    const gasUsed = await this.TransferManagerWrapper.estimate.transferToken(
      this.walletAddress, ETH_TOKEN, this.accounts[1], 1000000, "0x",
    );
    this._logger.addItem("ETH transfer, limit disabled (direct)", gasUsed);
  }

  async estimateTransferNoLimitRelayed() {
    // disable limit
    await this.TransferManagerWrapper.disableLimit(this.walletAddress);
    await this.testManager.increaseTime(this.config.settings.securityPeriod + 1);

    // transfer
    const gasUsed = await this.relay(
      this.TransferManagerWrapper,
      "transferToken",
      [this.walletAddress, ETH_TOKEN, this.accounts[1], 1000000, "0x"],
      this.wallet, [this.signers[0]],
    );
    this._logger.addItem("ETH transfer, limit disabled (relayed)", gasUsed);
  }

  async estimateETHSmallTransferDirect() {
    await this.TransferManagerWrapper.transferToken(this.walletAddress, ETH_TOKEN, this.accounts[5], 200, "0x");
    const gasUsed = await this.TransferManagerWrapper.estimate.transferToken(
      this.walletAddress, ETH_TOKEN, this.accounts[5], 200, "0x",
    );
    this._logger.addItem("ETH small transfer (direct)", gasUsed);
  }

  async estimateSmallTransferRelayedNoRefund() {
    const gasUsed = await this.relay(
      this.TransferManagerWrapper,
      "transferToken",
      [this.walletAddress, ETH_TOKEN, this.accounts[1], 1000, "0x"],
      this.wallet,
      [this.signers[0]],
    );
    this._logger.addItem("ETH small transfer No refund (relayed)", gasUsed);
  }

  async estimateSmallTransferRelayedWithRefund() {
    const nonce = await this.testManager.getNonceForRelay();
    const relayParams = [
      this.TransferManagerWrapper,
      "transferToken",
      [this.walletAddress, ETH_TOKEN, this.accounts[1], 1000, "0x"],
      this.wallet,
      [this.signers[0]],
      this.accounts[9],
      false,
      2000000,
      nonce,
      10,
      ETH_TOKEN];
    const txReceipt = await this.testManager.relay(...relayParams);
    const gasUsed = await txReceipt.gasUsed.toString();

    this._logger.addItem("ETH small transfer with ETH refund (relayed)", gasUsed);
  }

  async estimateETHTransferToWhitelistedAccountDirect() {
    await this.TransferManagerWrapper.addToWhitelist(this.walletAddress, this.accounts[3]);
    await this.testManager.increaseTime(this.config.settings.securityPeriod + 1);

    const gasUsed = await this.TransferManagerWrapper.estimate.transferToken(
      this.walletAddress, ETH_TOKEN, this.accounts[3], 2000000, "0x",
    );
    this._logger.addItem("ETH transfer to whitelisted account (direct)", gasUsed);
  }

  async estimateTransferToWhitelistedAccountRelayed() {
    await this.TransferManagerWrapper.addToWhitelist(this.walletAddress, this.accounts[3]);
    await this.testManager.increaseTime(this.config.settings.securityPeriod + 1);

    const gasUsed = await this.relay(
      this.TransferManagerWrapper,
      "transferToken",
      [this.walletAddress, ETH_TOKEN, this.accounts[3], 2000000, "0x"],
      this.wallet,
      [this.signers[0]],
    );
    this._logger.addItem("ETH transfer to whitelisted account (relayed)", gasUsed);
  }

  async estimateETHLargeTransferToUntrustedAccount() {
    const gasUsed = await this.TransferManagerWrapper.estimate.transferToken(
      this.walletAddress, ETH_TOKEN, this.accounts[2], 2000000, "0x",
    );
    this._logger.addItem("ETH large transfer to untrusted account", gasUsed);
  }

  async estimateLargeTransferApprovalByOneGuardian() {
    // estimate approve large transfer
    const gasUsed = await this.relay(
      this.ApprovedTransferWrapper,
      "transferToken",
      [this.walletAddress, ETH_TOKEN, this.accounts[3], 2000000, "0x"],
      this.wallet,
      [this.signers[0], this.signers[1]],
    );
    this._logger.addItem("ETH large transfer approval by one guardian", gasUsed);
  }

  async estimateLargeTransferApprovalByTwoGuardians() {
    // add 2 more guardians
    await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[2]);
    await this.GuardianManagerWrapper.addGuardian(this.walletAddress, this.accounts[3]);

    await this.testManager.increaseTime(this.config.settings.securityPeriod + this.config.settings.securityWindow / 2);

    await this.GuardianManagerWrapper.confirmGuardianAddition(this.walletAddress, this.accounts[2]);
    await this.GuardianManagerWrapper.confirmGuardianAddition(this.walletAddress, this.accounts[3]);

    // estimate approve large transfer
    const signers = [this.signers[0], this.signers[1], this.signers[2]];
    const gasUsed = await this.relay(
      this.ApprovedTransferWrapper,
      "transferToken",
      [this.walletAddress, ETH_TOKEN, this.accounts[5], 2000000, "0x"],
      this.wallet,
      signers,
    );
    this._logger.addItem("ETH large transfer approval by two guardians", gasUsed);
  }

  async estimateUpgradeWalletAllFeatures() {
    await this.testUpgradeAllFeatures();
  }

  // ///////////////////
  // //// utils ////////
  // ///////////////////

  async relay(target, method, params, wallet, signers) {
    const txReceipt = await this.testManager.relay(target, method, params, wallet, signers, this.accounts[9], false);
    return txReceipt.gasUsed.toString();
  }

  getAllEstimateMethods() {
    let props = [];
    let obj = this;

    do {
      props = props.concat(Object.getOwnPropertyNames(obj));
      obj = Object.getPrototypeOf(obj);
    } while (obj);

    return props.filter((prop) => prop.startsWith("estimate"));
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
