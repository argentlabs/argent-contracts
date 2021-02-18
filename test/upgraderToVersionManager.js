/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");
const TruffleContract = require("@truffle/contract");

const LegacyTransferManagerContract = require("../build-legacy/v1.6.0/TransferManager.json");

const LegacyTransferManager = TruffleContract(LegacyTransferManagerContract);

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const VersionManager = artifacts.require("VersionManager");
const TransferStorage = artifacts.require("TransferStorage");
const LockStorage = artifacts.require("LockStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const LimitStorage = artifacts.require("LimitStorage");
const RelayerManager = artifacts.require("RelayerManager");
const TransferManager = artifacts.require("TransferManager");
const UpgraderToVersionManager = artifacts.require("UpgraderToVersionManager");

const SECURITY_PERIOD = 3600;
const SECURITY_WINDOW = 3600;
const ETH_LIMIT = 1000000;

const RelayManager = require("../utils/relay-manager");
const utils = require("../utils/utilities.js");

contract("UpgraderToVersionManager", (accounts) => {
  const manager = new RelayManager();

  const owner = accounts[1];
  const recipient = accounts[2];

  let transferStorage;
  let lockStorage;
  let guardianStorage;
  let limitStorage;
  let transferManager;
  let previousTransferManager;
  let wallet;
  let walletImplementation;
  let relayerManager;
  let versionManager;
  let upgrader;

  before(async () => {
    LegacyTransferManager.defaults({ from: accounts[0] });
    LegacyTransferManager.setProvider(web3.currentProvider);

    walletImplementation = await BaseWallet.new();
    const registry = await Registry.new();
    lockStorage = await LockStorage.new();
    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();

    // Deploy old architecture
    previousTransferManager = await LegacyTransferManager.new(
      registry.address,
      transferStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      ETH_LIMIT,
      ethers.constants.AddressZero);

    // Deploy new modules
    limitStorage = await LimitStorage.new();
    versionManager = await VersionManager.new(
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      transferStorage.address,
      limitStorage.address);
    upgrader = await UpgraderToVersionManager.new(
      registry.address,
      lockStorage.address,
      [previousTransferManager.address], // toDisable
      versionManager.address);
    await registry.registerModule(versionManager.address, ethers.utils.formatBytes32String("VersionManager"));
    await registry.registerModule(upgrader.address, ethers.utils.formatBytes32String("Upgrader"));

    // Deploy new features
    transferManager = await TransferManager.new(
      lockStorage.address,
      transferStorage.address,
      limitStorage.address,
      ethers.constants.AddressZero,
      versionManager.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      ETH_LIMIT,
      ethers.constants.AddressZero,
      previousTransferManager.address);
    relayerManager = await RelayerManager.new(
      lockStorage.address,
      guardianStorage.address,
      limitStorage.address,
      ethers.constants.AddressZero,
      versionManager.address);
    await manager.setRelayerManager(relayerManager);
    await versionManager.addVersion([transferManager.address, relayerManager.address], [transferManager.address]);
  });

  it("should fail to upgrade a pre-VersionManager wallet to a version lower than minVersion", async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [previousTransferManager.address]);
    const prevVersion = await versionManager.lastVersion();
    await versionManager.addVersion([], []);
    const lastVersion = await versionManager.lastVersion();
    await versionManager.setMinVersion(lastVersion);
    await truffleAssert.reverts(
      previousTransferManager.addModule(wallet.address, upgrader.address, { from: owner }),
      "VM: invalid _toVersion",
    );
    await versionManager.setMinVersion(prevVersion);
  });

  describe("After migrating a pre-VersionManager wallet", () => {
    beforeEach(async () => {
      const proxy = await Proxy.new(walletImplementation.address);
      wallet = await BaseWallet.at(proxy.address);

      await wallet.init(owner, [previousTransferManager.address]);
      await previousTransferManager.addModule(wallet.address, upgrader.address, { from: owner });
    });

    it("should add/remove an account to/from the whitelist", async () => {
      await transferManager.addToWhitelist(wallet.address, recipient, { from: owner });
      await utils.increaseTime(SECURITY_PERIOD + 1);
      let isTrusted = await transferManager.isWhitelisted(wallet.address, recipient);
      assert.equal(isTrusted, true, "should be trusted after the security period");
      await transferManager.removeFromWhitelist(wallet.address, recipient, { from: owner });
      isTrusted = await transferManager.isWhitelisted(wallet.address, recipient);
      assert.equal(isTrusted, false, "should no removed from whitelist immediately");
    });

    it("should change the limit via relayed transaction", async () => {
      await manager.relay(transferManager, "changeLimit", [wallet.address, 4000000], wallet, [owner]);
      await utils.increaseTime(SECURITY_PERIOD + 1);
      const limit = await transferManager.getCurrentLimit(wallet.address);
      assert.equal(limit.toNumber(), 4000000, "limit should be changed");
    });
  });
});
