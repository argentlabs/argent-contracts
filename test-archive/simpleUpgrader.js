/* global artifacts */

const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const { formatBytes32String, parseBytes32String } = require("ethers").utils;
const utils = require("../utils/utilities.js");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const SimpleUpgrader = artifacts.require("SimpleUpgrader");
const GuardianManager = artifacts.require("GuardianManager");
const LockManager = artifacts.require("LockManager");
const GuardianStorage = artifacts.require("GuardianStorage");
const LockStorage = artifacts.require("LockStorage");
const Registry = artifacts.require("ModuleRegistry");
const RecoveryManager = artifacts.require("RecoveryManager");
const VersionManager = artifacts.require("VersionManager");
const RelayerManager = artifacts.require("RelayerManager");

const RelayManager = require("../utils/relay-manager");

contract("SimpleUpgrader", (accounts) => {
  const manager = new RelayManager();

  const owner = accounts[1];
  let registry;
  let guardianStorage;
  let lockStorage;
  let walletImplementation;
  let wallet;

  before(async () => {
    walletImplementation = await BaseWallet.new();
  });

  beforeEach(async () => {
    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    lockStorage = await LockStorage.new();

    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
  });

  async function deployTestModule() {
    const module = await VersionManager.new(
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    const relayer = await RelayerManager.new(
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      module.address);
    await module.addVersion([relayer.address], []);
    return { module, relayer };
  }

  describe("Registering modules", () => {
    it("should register modules in the registry", async () => {
      const name = "test_1.1";
      const { module: initialModule } = await deployTestModule();
      await registry.registerModule(initialModule.address, formatBytes32String(name));
      const isRegistered = await registry.contract.methods["isRegisteredModule(address[])"]([initialModule.address]).call();
      assert.equal(isRegistered, true, "module1 should be registered");
      const info = await registry.moduleInfo(initialModule.address);
      assert.equal(parseBytes32String(info), name, "module1 should be registered with the correct name");
    });

    it("should add registered modules to a wallet", async () => {
      // create modules
      const { module: initialModule } = await deployTestModule();
      const { module: moduleToAdd } = await deployTestModule();
      // register module
      await registry.registerModule(initialModule.address, formatBytes32String("initial"));
      await registry.registerModule(moduleToAdd.address, formatBytes32String("added"));

      await wallet.init(owner, [initialModule.address]);
      await initialModule.upgradeWallet(wallet.address, await initialModule.lastVersion(), { from: owner });
      let isAuthorised = await wallet.authorised(initialModule.address);
      assert.equal(isAuthorised, true, "initial module should be authorised");
      // add module to wallet
      await initialModule.addModule(wallet.address, moduleToAdd.address, { from: owner });

      isAuthorised = await wallet.authorised(moduleToAdd.address);
      assert.equal(isAuthorised, true, "added module should be authorised");
    });

    it("should block addition of unregistered modules to a wallet", async () => {
      // create modules
      const { module: initialModule } = await deployTestModule();
      const { module: moduleToAdd } = await deployTestModule();
      // register initial module only
      await registry.registerModule(initialModule.address, formatBytes32String("initial"));

      await wallet.init(owner, [initialModule.address]);
      await initialModule.upgradeWallet(wallet.address, await initialModule.lastVersion(), { from: owner });
      let isAuthorised = await wallet.authorised(initialModule.address);
      assert.equal(isAuthorised, true, "initial module should be authorised");
      // try (and fail) to add moduleToAdd to wallet
      await truffleAssert.reverts(initialModule.addModule(wallet.address, moduleToAdd.address, { from: owner }), "VM: module is not registered");
      isAuthorised = await wallet.authorised(moduleToAdd.address);
      assert.equal(isAuthorised, false, "unregistered module should not be authorised");
    });

    it("should not be able to upgrade to unregistered module", async () => {
      // create module V1
      const { module: moduleV1 } = await deployTestModule();
      // register module V1
      await registry.registerModule(moduleV1.address, formatBytes32String("V1"));

      await wallet.init(owner, [moduleV1.address]);
      await moduleV1.upgradeWallet(wallet.address, await moduleV1.lastVersion(), { from: owner });
      // create module V2
      const { module: moduleV2 } = await deployTestModule();
      // create upgrader
      const upgrader = await SimpleUpgrader.new(
        registry.address, lockStorage.address, [moduleV1.address], [moduleV2.address]);
      await registry.registerModule(upgrader.address, formatBytes32String("V1toV2"));

      // check we can't upgrade from V1 to V2
      await truffleAssert.reverts(moduleV1.addModule(wallet.address, upgrader.address, { from: owner }), "SU: Not all modules are registered");
      // register module V2
      await registry.registerModule(moduleV2.address, formatBytes32String("V2"));
      // now we can upgrade
      await moduleV1.addModule(wallet.address, upgrader.address, { from: owner });

      // test if the upgrade worked
      const isV1Authorised = await wallet.authorised(moduleV1.address);
      const isV2Authorised = await wallet.authorised(moduleV2.address);
      const isUpgraderAuthorised = await wallet.authorised(upgrader.address);
      const numModules = await wallet.modules();
      assert.isFalse(isV1Authorised, "moduleV1 should be unauthorised");
      assert.isTrue(isV2Authorised, "moduleV2 should be authorised");
      assert.equal(isUpgraderAuthorised, false, "upgrader should not be authorised");
      assert.equal(numModules, 1, "only one module (moduleV2) should be authorised");
    });
  });

  describe("Upgrading modules", () => {
    async function testUpgradeModule({ relayed, modulesToAdd = (moduleV2) => [moduleV2] }) {
      // create module V1
      const { module: moduleV1, relayer: relayerV1 } = await deployTestModule();
      await manager.setRelayerManager(relayerV1);
      // register module V1
      await registry.registerModule(moduleV1.address, formatBytes32String("V1"));
      // create wallet with module V1 and relayer feature
      const proxy = await Proxy.new(walletImplementation.address);
      wallet = await BaseWallet.at(proxy.address);
      await wallet.init(owner, [moduleV1.address]);
      await moduleV1.upgradeWallet(wallet.address, await moduleV1.lastVersion(), { from: owner });

      // create module V2
      const { module: moduleV2 } = await deployTestModule();
      // register module V2
      await registry.registerModule(moduleV2.address, formatBytes32String("V2"));
      // create upgraders
      const toAdd = modulesToAdd(moduleV2.address);
      const upgrader1 = await SimpleUpgrader.new(
        registry.address, lockStorage.address, [moduleV1.address], toAdd);
      const upgrader2 = await SimpleUpgrader.new(
        registry.address, lockStorage.address, [moduleV1.address], toAdd);
      await registry.registerModule(upgrader1.address, formatBytes32String("V1toV2_1"));
      await registry.registerModule(upgrader2.address, formatBytes32String("V1toV2_2"));

      // upgrade from V1 to V2
      let txReceipt;
      const params1 = [wallet.address, upgrader1.address];
      const params2 = [wallet.address, upgrader2.address];
      // if no module is added and all modules are removed, the upgrade should fail
      if (toAdd.length === 0) {
        if (relayed) {
          txReceipt = await manager.relay(moduleV1, "addModule", params2, wallet, [owner]);
          const event = await utils.getEvent(txReceipt, relayerV1, "TransactionExecuted");
          assert.isTrue(!event.args.success, "Relayed upgrade to 0 module should have failed.");
        } else {
          truffleAssert.reverts(moduleV1.addModule(...params2, { from: owner }), "BW: wallet must have at least one module");
        }
        return;
      }
      if (relayed) {
        txReceipt = await manager.relay(moduleV1, "addModule", params1, wallet, [owner]);
        const event = await utils.getEvent(txReceipt, relayerV1, "TransactionExecuted");
        assert.isTrue(event.args.success, "Relayed tx should only have succeeded if an OnlyOwnerModule was used");
      } else {
        const tx = await moduleV1.addModule(...params1, { from: owner });
        txReceipt = tx.receipt;
      }

      // test event ordering
      const event = await utils.getEvent(txReceipt, wallet, "AuthorisedModule");
      assert.equal(event.args.module, upgrader1.address);
      assert.isTrue(event.args.value);

      // test if the upgrade worked
      const isV1Authorised = await wallet.authorised(moduleV1.address);
      const isV2Authorised = await wallet.authorised(moduleV2.address);
      const isUpgraderAuthorised = await wallet.authorised(upgrader1.address);
      const numModules = await wallet.modules();
      assert.equal(isV1Authorised, false, "moduleV1 should be unauthorised");
      assert.equal(isV2Authorised, true, "moduleV2 should be authorised");
      assert.equal(isUpgraderAuthorised, false, "upgrader should not be authorised");
      assert.equal(numModules.toNumber(), 1, "only 1 module (moduleV2) should be authorised");
    }

    it("should upgrade modules (relayed tx)", async () => {
      await testUpgradeModule({ relayed: true });
    });

    it("should not upgrade to 0 module (blockchain tx)", async () => {
      // we intentionally try to add 0 module, this should fail
      await testUpgradeModule({ relayed: false, modulesToAdd: (v2) => [] }); // eslint-disable-line no-unused-vars
    });

    it("should not upgrade to 0 module (relayed tx)", async () => {
      // we intentionally try to add 0 module, this should fail
      await testUpgradeModule({ relayed: true, modulesToAdd: (v2) => [] }); // eslint-disable-line no-unused-vars
    });
  });

  describe("Upgrading when wallet is locked", () => {
    let versionManager;
    let relayerManager;
    let guardianManager;
    let lockManager;
    let recoveryManager;
    let moduleV2;
    const guardian = accounts[2];
    const newowner = accounts[3];

    beforeEach(async () => {
      // Setup the module for wallet
      versionManager = await VersionManager.new(
        registry.address,
        lockStorage.address,
        guardianStorage.address,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero);
      guardianManager = await GuardianManager.new(
        lockStorage.address,
        guardianStorage.address,
        versionManager.address,
        24, 12);
      lockManager = await LockManager.new(
        lockStorage.address,
        guardianStorage.address,
        versionManager.address,
        24 * 5);
      recoveryManager = await RecoveryManager.new(
        lockStorage.address,
        guardianStorage.address,
        versionManager.address,
        36, 24 * 5);
      relayerManager = await RelayerManager.new(
        lockStorage.address,
        guardianStorage.address,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        versionManager.address);
      await manager.setRelayerManager(relayerManager);

      // Setup the wallet with the initial set of modules
      await versionManager.addVersion([
        guardianManager.address,
        lockManager.address,
        recoveryManager.address,
        relayerManager.address,
      ], []);
      await wallet.init(owner, [versionManager.address]);
      await versionManager.upgradeWallet(wallet.address, await versionManager.lastVersion(), { from: owner });
      await guardianManager.addGuardian(wallet.address, guardian, { from: owner });

      // Setup module v2 for the upgrade
      const { module } = await deployTestModule();
      moduleV2 = module;
      await registry.registerModule(moduleV2.address, formatBytes32String("V2"));
    });

    it("should not be able to upgrade if wallet is locked by guardian", async () => {
      const upgrader = await SimpleUpgrader.new(
        lockStorage.address, registry.address, [versionManager.address], [moduleV2.address]);
      await registry.registerModule(upgrader.address, formatBytes32String("V1toV2"));

      // Guardian locks the wallet
      await lockManager.lock(wallet.address, { from: guardian });

      // Try to upgrade while wallet is locked
      await truffleAssert.reverts(versionManager.addModule(wallet.address, upgrader.address, { from: owner }), "BF: wallet locked");

      // Check wallet is still locked
      const locked = await lockManager.isLocked(wallet.address);
      assert.isTrue(locked);
      // Check upgrade failed
      const isV1Authorised = await wallet.authorised(versionManager.address);
      const isV2Authorised = await wallet.authorised(moduleV2.address);
      assert.isTrue(isV1Authorised);
      assert.isFalse(isV2Authorised);
    });

    it("should not be able to upgrade if wallet is under recovery", async () => {
      const upgrader = await SimpleUpgrader.new(
        lockStorage.address,
        registry.address,
        [versionManager.address],
        [moduleV2.address],
      );
      await registry.registerModule(upgrader.address, formatBytes32String("V1toV2"));

      // Put the wallet under recovery
      await manager.relay(recoveryManager, "executeRecovery", [wallet.address, newowner], wallet, [guardian]);
      // check that the wallet is locked
      let locked = await lockManager.isLocked(wallet.address);
      assert.isTrue(locked, "wallet should be locked");

      // Try to upgrade while wallet is under recovery
      await truffleAssert.reverts(versionManager.addModule(wallet.address, upgrader.address, { from: owner }), "BF: wallet locked");

      // Check wallet is still locked
      locked = await lockManager.isLocked(wallet.address);
      assert.isTrue(locked, "wallet should still be locked");

      // Check upgrade failed
      const isV1Authorised = await wallet.authorised(versionManager.address);
      const isV2Authorised = await wallet.authorised(moduleV2.address);
      assert.isTrue(isV1Authorised);
      assert.isFalse(isV2Authorised);
    });
  });
});
