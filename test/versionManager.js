/* global accounts */
const ethers = require("ethers");
const GuardianManager = require("../build/GuardianManager");
const LockStorage = require("../build/LockStorage");
const GuardianStorage = require("../build/GuardianStorage");
const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");
const RelayerManager = require("../build/RelayerManager");
const VersionManager = require("../build/VersionManager");
const Registry = require("../build/ModuleRegistry");
const TestFeature = require("../build/TestFeature");

const TestManager = require("../utils/test-manager");

describe("VersionManager", function () {
  this.timeout(100000);

  const manager = new TestManager(accounts);

  const owner = accounts[1].signer;

  let deployer;
  let wallet;
  let walletImplementation;
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
    const registry = await deployer.deploy(Registry);
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
      true,
      42);
    await versionManager.addVersion([guardianManager.contractAddress, relayerManager.contractAddress, testFeature.contractAddress], []);
    await versionManager.setNewWalletVersion(await versionManager.lastVersion());
    manager.setRelayerManager(relayerManager);

    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
    await wallet.init(owner.address, [versionManager.contractAddress]);
  });

  describe("VersionManager owner", () => {
    it("should not let the VersionManager owner add a storage twice", async () => {
      await assert.revertWith(versionManager.addStorage(lockStorage.contractAddress), "VM: Storage already added");
    });

    it("should not let the VersionManager owner add an inconsistent version", async () => {
      // Should fail: the _featuresToInit array includes a feature not listed in the _features array
      await assert.revertWith(
        versionManager.addVersion([relayerManager.contractAddress], [guardianManager.contractAddress]),
        "VM: Invalid _featuresToInit",
      );
    });

    it("should not let the VersionManager owner set an invalid version for new wallets", async () => {
      await assert.revertWith(versionManager.setNewWalletVersion(0), "VM: New wallet version is invalid");
    });

    it("should let the VersionManager owner pick the new wallet version", async () => {
      const newTestFeature = await deployer.deploy(TestFeature, {},
        lockStorage.contractAddress,
        versionManager.contractAddress,
        true,
        42);
      await versionManager.addVersion([newTestFeature.contractAddress], []);
      const targetVersion = await versionManager.lastVersion();
      await versionManager.addVersion([guardianManager.contractAddress, relayerManager.contractAddress, testFeature.contractAddress], []);
      await versionManager.setNewWalletVersion(targetVersion);

      const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
      const newWallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
      await newWallet.init(owner.address, [versionManager.contractAddress]);
      const hasNewTestFeature = await versionManager.isFeatureAuthorised(newWallet.contractAddress, newTestFeature.contractAddress);
      const hasGuadianManager = await versionManager.isFeatureAuthorised(newWallet.contractAddress, guardianManager.contractAddress);
      assert.isTrue(hasNewTestFeature, "Features from target version should be authorised");
      assert.isFalse(hasGuadianManager, "Features from non-target version should not be authorised");
    });
  });

  describe("Wallet owner", () => {
    it("should not let the relayer call a forbidden method", async () => {
      await assert.revertWith(
        manager.relay(versionManager, "setOwner", [wallet.contractAddress, owner.address], wallet, [owner]),
        "VM: unknown method",
      );
    });

    it("should fail to upgrade a wallet when already on the last version", async () => {
      const lastVersion = await versionManager.lastVersion();
      await assert.revertWith(
        versionManager.from(owner).upgradeWallet(wallet.contractAddress, lastVersion),
        "VM: Already on last version",
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
  });
});
