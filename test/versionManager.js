/* global accounts */
const ethers = require("ethers");

const GuardianManager = require("../build/GuardianManager");
const LockStorage = require("../build/LockStorage");
const GuardianStorage = require("../build/GuardianStorage");
const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");
const RelayerManager = require("../build/RelayerManager");
const VersionManager = require("../build/VersionManager");
const TransferStorage = require("../build/TransferStorage");
const LimitStorage = require("../build/LimitStorage");
const TokenPriceRegistry = require("../build/TokenPriceRegistry");
const TransferManager = require("../build/TransferManager");
const Registry = require("../build/ModuleRegistry");
const TestFeature = require("../build/TestFeature");
const UpgraderToVersionManager = require("../build/UpgraderToVersionManager");

const RelayManager = require("../utils/relay-manager");

describe("VersionManager", function () {
  this.timeout(100000);

  const manager = new RelayManager(accounts);

  const owner = accounts[1].signer;

  let deployer;
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
    deployer = manager.newDeployer();
    walletImplementation = await deployer.deploy(BaseWallet);
  });

  beforeEach(async () => {
    registry = await deployer.deploy(Registry);
    lockStorage = await deployer.deploy(LockStorage);
    guardianStorage = await deployer.deploy(GuardianStorage);
    versionManager = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    relayerManager = await deployer.deploy(RelayerManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.contractAddress);
    guardianManager = await deployer.deploy(GuardianManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      versionManager.contractAddress,
      24,
      12);
    testFeature = await deployer.deploy(TestFeature, {},
      lockStorage.contractAddress,
      versionManager.contractAddress,
      42);
    await versionManager.addVersion([guardianManager.contractAddress, relayerManager.contractAddress, testFeature.contractAddress], []);
    manager.setRelayerManager(relayerManager);

    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
    await wallet.init(owner, [versionManager.contractAddress]);
    await versionManager.from(owner).upgradeWallet(wallet.contractAddress, await versionManager.lastVersion());
  });

  describe("VersionManager owner", () => {
    it("should not let the VersionManager owner add a storage twice", async () => {
      await assert.revertWith(versionManager.addStorage(lockStorage.contractAddress), "VM: storage already added");
    });

    it("should not let the VersionManager owner add an inconsistent version", async () => {
      // Should fail: the _featuresToInit array includes a feature not listed in the _features array
      await assert.revertWith(
        versionManager.addVersion([relayerManager.contractAddress], [guardianManager.contractAddress]),
        "VM: invalid _featuresToInit",
      );
    });

    it("should not let the VersionManager owner set an invalid minVersion", async () => {
      const lastVersion = await versionManager.lastVersion();
      await assert.revertWith(
        versionManager.setMinVersion(0),
        "VM: invalid _minVersion",
      );
      await assert.revertWith(
        versionManager.setMinVersion(lastVersion.add(1)),
        "VM: invalid _minVersion",
      );
    });
  });

  describe("Wallet owner", () => {
    it("should not let the relayer call a forbidden method", async () => {
      await assert.revertWith(
        manager.relay(versionManager, "setOwner", [wallet.contractAddress, owner], wallet, [owner]),
        "VM: unknown method",
      );
    });

    it("should fail to upgrade a wallet when already on the last version", async () => {
      const lastVersion = await versionManager.lastVersion();
      await assert.revertWith(
        versionManager.from(owner).upgradeWallet(wallet.contractAddress, lastVersion),
        "VM: already on new version",
      );
    });

    it("should fail to upgrade a wallet to a version lower than minVersion", async () => {
      const badVersion = await versionManager.lastVersion();
      await versionManager.addVersion([], []);
      await versionManager.setMinVersion(await versionManager.lastVersion());

      await assert.revertWith(
        versionManager.from(owner).upgradeWallet(wallet.contractAddress, badVersion),
        "VM: invalid _toVersion",
      );
    });

    it("should not let a feature call an unauthorised storage", async () => {
      // Note: we are calling the deprecated GuardianStorage.setLock so this particular method gets touched by coverage
      const data1 = guardianStorage.contract.interface.functions.setLock.encode([wallet.contractAddress, 1]);
      await testFeature.from(owner).invokeStorage(wallet.contractAddress, guardianStorage.contractAddress, data1);
      let lock = await guardianStorage.getLock(wallet.contractAddress);
      assert.isTrue(lock.eq(1), "Lock should have been set");
      const data0 = guardianStorage.contract.interface.functions.setLock.encode([wallet.contractAddress, 0]);
      await testFeature.from(owner).invokeStorage(wallet.contractAddress, guardianStorage.contractAddress, data0);
      lock = await guardianStorage.getLock(wallet.contractAddress);
      assert.isTrue(lock.eq(0), "Lock should have been unset");

      const newGuardianStorage = await deployer.deploy(GuardianStorage); // not authorised in VersionManager
      await assert.revertWith(
        testFeature.from(owner).invokeStorage(wallet.contractAddress, newGuardianStorage.contractAddress, data1),
        "VM: invalid storage invoked",
      );
      lock = await newGuardianStorage.getLock(wallet.contractAddress);
      assert.isTrue(lock.eq(0), "Lock should not be set");
    });

    it("should not allow the fallback to be called via a non-static call", async () => {
      // Deploy new VersionManager with TransferManager
      const versionManager2 = await deployer.deploy(VersionManager, {},
        registry.contractAddress,
        lockStorage.contractAddress,
        guardianStorage.contractAddress,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero);
      const tokenPriceRegistry = await deployer.deploy(TokenPriceRegistry);
      const transferStorage = await deployer.deploy(TransferStorage);
      const limitStorage = await deployer.deploy(LimitStorage);
      const transferManager = await deployer.deploy(TransferManager, {},
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
      const upgrader = await deployer.deploy(UpgraderToVersionManager, {},
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
