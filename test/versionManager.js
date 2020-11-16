/* global artifacts */
const ethers = require("ethers");

const GuardianManager = artifacts.require("GuardianManager");
const LockStorage = artifacts.require("LockStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const RelayerManager = artifacts.require("RelayerManager");
const VersionManager = artifacts.require("VersionManager");
const Registry = artifacts.require("ModuleRegistry");
const TestFeature = artifacts.require("TestFeature");
const TransferStorage = artifacts.require("TransferStorage");
const LimitStorage = artifacts.require("LimitStorage");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const TransferManager = artifacts.require("TransferManager");
const UpgraderToVersionManager = artifacts.require("UpgraderToVersionManager");

const utils = require("../utils/utilities.js");
const RelayManager = require("../utils/relay-manager");

contract("VersionManager", (accounts) => {
  const manager = new RelayManager(accounts);
  const owner = accounts[1];

  let wallet;
  let walletImplementation;
  let registry;
  let lockStorage;
  let guardianStorage;
  let guardianManager;
  let relayerManager;
  let versionManager;
  let testFeature;

  before(async () => {
    walletImplementation = await BaseWallet.new();
  });

  beforeEach(async () => {
    registry = await Registry.new();
    lockStorage = await LockStorage.new();
    guardianStorage = await GuardianStorage.new();
    versionManager = await VersionManager.new(
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    relayerManager = await RelayerManager.new(
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.address);
    guardianManager = await GuardianManager.new(
      lockStorage.address,
      guardianStorage.address,
      versionManager.address,
      24,
      12);
    testFeature = await TestFeature.new(
      lockStorage.address,
      versionManager.address,
      42);
    await versionManager.addVersion([guardianManager.address, relayerManager.address, testFeature.address], []);
    manager.setRelayerManager(relayerManager);

    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [versionManager.address]);
    await versionManager.upgradeWallet(wallet.address, await versionManager.lastVersion(), { from: owner });
  });

  describe("VersionManager owner", () => {
    it("should not let the VersionManager owner add a storage twice", async () => {
      await utils.assertRevert(versionManager.addStorage(lockStorage.address), "VM: storage already added");
    });

    it("should not let the VersionManager owner add an inconsistent version", async () => {
      // Should fail: the _featuresToInit array includes a feature not listed in the _features array
      await utils.assertRevert(
        versionManager.addVersion([relayerManager.address], [guardianManager.address]),
        "VM: invalid _featuresToInit",
      );
    });

    it("should not let the VersionManager owner set an invalid minVersion", async () => {
      const lastVersion = await versionManager.lastVersion();

      await utils.assertRevert(
        versionManager.setMinVersion(0),
        "VM: invalid _minVersion",
      );

      await utils.assertRevert(
        versionManager.setMinVersion(lastVersion.addn(1)),
        "VM: invalid _minVersion",
      );
    });
  });

  describe("Wallet owner", () => {
    it("should not let the relayer call a forbidden method", async () => {
      await utils.assertRevert(
        manager.relay(versionManager, "setOwner", [wallet.address, owner], wallet, [owner]),
        "VM: unknown method",
      );
    });

    it("should fail to upgrade a wallet when already on the last version", async () => {
      const lastVersion = await versionManager.lastVersion();
      await utils.assertRevert(
        versionManager.upgradeWallet(wallet.address, lastVersion, { from: owner }),
        "VM: already on new version",
      );
    });

    it("should fail to upgrade a wallet to a version lower than minVersion", async () => {
      const badVersion = await versionManager.lastVersion();
      await versionManager.addVersion([], []);
      await versionManager.setMinVersion(await versionManager.lastVersion());

      await utils.assertRevert(
        versionManager.upgradeWallet(wallet.address, badVersion, { from: owner }),
        "VM: invalid _toVersion",
      );
    });

    it("should not let a feature call an unauthorised storage", async () => {
      // Note: we are calling the deprecated GuardianStorage.setLock so this particular method gets touched by coverage
      const data1 = guardianStorage.contract.methods.setLock(wallet.address, 1).encodeABI();

      await testFeature.invokeStorage(wallet.address, guardianStorage.address, data1, { from: owner });
      let lock = await guardianStorage.getLock(wallet.address);
      assert.equal(lock, 1, "Lock should have been set");
      const data0 = guardianStorage.contract.methods.setLock(wallet.address, 0).encodeABI();

      await testFeature.invokeStorage(wallet.address, guardianStorage.address, data0, { from: owner });
      lock = await guardianStorage.getLock(wallet.address);
      assert.equal(lock, 0, "Lock should have been unset");

      const newGuardianStorage = await GuardianStorage.new(); // not authorised in VersionManager
      await utils.assertRevert(
        testFeature.invokeStorage(wallet.address, newGuardianStorage.address, data1, { from: owner }),
        "VM: invalid storage invoked",
      );
      lock = await newGuardianStorage.getLock(wallet.address);
      assert.equal(lock, 0, "Lock should not be set");
    });

    it("should not allow the fallback to be called via a non-static call", async () => {
      // Deploy new VersionManager with TransferManager
      const versionManager2 = await VersionManager.new(
        registry.contractAddress,
        lockStorage.contractAddress,
        guardianStorage.contractAddress,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero);
      const tokenPriceRegistry = await TokenPriceRegistry.new();
      const transferStorage = await TransferStorage.new();
      const limitStorage = await LimitStorage.new();
      const transferManager = await TransferManager.new(
        lockStorage.contractAddress,
        transferStorage.contractAddress,
        limitStorage.contractAddress,
        tokenPriceRegistry.contractAddress,
        versionManager2.contractAddress,
        3600,
        3600,
        10000,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero);
      await versionManager2.addVersion([transferManager.contractAddress], []);
      await registry.registerModule(versionManager2.contractAddress, ethers.utils.formatBytes32String("VersionManager2"));

      // Deploy Upgrader to new VersionManager
      const upgrader = await UpgraderToVersionManager.new(
        registry.contractAddress,
        lockStorage.contractAddress,
        [versionManager.contractAddress], // toDisable
        versionManager2.contractAddress);
      await registry.registerModule(upgrader.contractAddress, ethers.utils.formatBytes32String("Upgrader"));

      // Upgrade wallet to new VersionManger
      await versionManager.from(owner).addModule(wallet.contractAddress, upgrader.contractAddress);

      // Attempt to call a malicious (non-static) call on the old VersionManager
      const data = testFeature.contract.interface.functions.badStaticCall.encode([]);
      await assert.revertWith(
        transferManager.from(owner).callContract(wallet.contractAddress, versionManager.contractAddress, 0, data),
        "VM: not in a staticcall",
      );
    });
  });
});
