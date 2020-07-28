/* global artifacts */

const ethers = require("ethers");
const utils = require("../utils/utilities.js");

const { formatBytes32String, parseBytes32String } = require("ethers").utils;
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
const TestManager = artifacts.require("test-manager");

contract("SimpleUpgrader", (accounts) => {
  const manager = new TestManager();

  const owner = accounts[1];
  let deployer;
  let registry;
  let guardianStorage;
  let lockStorage;
  let walletImplementation;
  let wallet;

  before(async () => {
    deployer = manager.newDeployer();
    walletImplementation = await deployer.deploy(BaseWallet);
  });

  beforeEach(async () => {
    registry = await deployer.deploy(Registry);
    guardianStorage = await deployer.deploy(GuardianStorage);
    lockStorage = await deployer.deploy(LockStorage);

    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
  });

  async function deployTestModule() {
    const module = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    const relayer = await deployer.deploy(RelayerManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      module.contractAddress);
    await module.addVersion([relayer.contractAddress], []);
    return { module, relayer };
  }

  describe("Registering modules", () => {
    it("should register modules in the registry", async () => {
      const name = "test_1.1";
      const { module: initialModule } = await deployTestModule();
      await registry.registerModule(initialModule.contractAddress, formatBytes32String(name));
      // Here we adjust how we call isRegisteredModule which has 2 overlaods, one accepting a single address
      // and a second accepting an array of addresses. Behaviour as to which overload is selected to run
      // differs between CI and Coverage environments, adjusted for this here
      const isRegistered = await registry["isRegisteredModule(address)"](initialModule.contractAddress);

      assert.equal(isRegistered, true, "module1 should be registered");
      const info = await registry.moduleInfo(initialModule.contractAddress);
      assert.equal(parseBytes32String(info), name, "module1 should be registered with the correct name");
    });

    it("should add registered modules to a wallet", async () => {
      // create modules
      const { module: initialModule } = await deployTestModule();
      const { module: moduleToAdd } = await deployTestModule();
      // register module
      await registry.registerModule(initialModule.contractAddress, formatBytes32String("initial"));
      await registry.registerModule(moduleToAdd.contractAddress, formatBytes32String("added"));

      await wallet.init(owner, [initialModule.contractAddress]);
      await initialModule.from(owner).upgradeWallet(wallet.contractAddress, await initialModule.lastVersion());
      let isAuthorised = await wallet.authorised(initialModule.contractAddress);
      assert.equal(isAuthorised, true, "initial module should be authorised");
      // add module to wallet
      await initialModule.from(owner).addModule(wallet.contractAddress, moduleToAdd.contractAddress);

      isAuthorised = await wallet.authorised(moduleToAdd.contractAddress);
      assert.equal(isAuthorised, true, "added module should be authorised");
    });

    it("should block addition of unregistered modules to a wallet", async () => {
      // create modules
      const { module: initialModule } = await deployTestModule();
      const { module: moduleToAdd } = await deployTestModule();
      // register initial module only
      await registry.registerModule(initialModule.contractAddress, formatBytes32String("initial"));

      await wallet.init(owner, [initialModule.contractAddress]);
      await initialModule.from(owner).upgradeWallet(wallet.contractAddress, await initialModule.lastVersion());
      let isAuthorised = await wallet.authorised(initialModule.contractAddress);
      assert.equal(isAuthorised, true, "initial module should be authorised");
      // try (and fail) to add moduleToAdd to wallet
      await assert.revert(initialModule.from(owner).addModule(wallet.contractAddress, moduleToAdd.contractAddress));
      isAuthorised = await wallet.authorised(moduleToAdd.contractAddress);
      assert.equal(isAuthorised, false, "unregistered module should not be authorised");
    });

    it("should not be able to upgrade to unregistered module", async () => {
      // create module V1
      const { module: moduleV1 } = await deployTestModule();
      // register module V1
      await registry.registerModule(moduleV1.contractAddress, formatBytes32String("V1"));

      await wallet.init(owner, [moduleV1.contractAddress]);
      await moduleV1.from(owner).upgradeWallet(wallet.contractAddress, await moduleV1.lastVersion());
      // create module V2
      const { module: moduleV2 } = await deployTestModule();
      // create upgrader
      const upgrader = await deployer.deploy(SimpleUpgrader, {},
        registry.contractAddress, lockStorage.contractAddress, [moduleV1.contractAddress], [moduleV2.contractAddress]);
      await registry.registerModule(upgrader.contractAddress, formatBytes32String("V1toV2"));

      // check we can't upgrade from V1 to V2
      await assert.revertWith(moduleV1.from(owner).addModule(wallet.contractAddress, upgrader.contractAddress), "SU: Not all modules are registered");
      // register module V2
      await registry.registerModule(moduleV2.contractAddress, formatBytes32String("V2"));
      // now we can upgrade
      await moduleV1.from(owner).addModule(wallet.contractAddress, upgrader.contractAddress);

      // test if the upgrade worked
      const isV1Authorised = await wallet.authorised(moduleV1.contractAddress);
      const isV2Authorised = await wallet.authorised(moduleV2.contractAddress);
      const isUpgraderAuthorised = await wallet.authorised(upgrader.contractAddress);
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
      manager.setRelayerManager(relayerV1);
      // register module V1
      await registry.registerModule(moduleV1.contractAddress, formatBytes32String("V1"));
      // create wallet with module V1 and relayer feature
      const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
      wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
      await wallet.init(owner, [moduleV1.contractAddress]);
      await moduleV1.from(owner).upgradeWallet(wallet.contractAddress, await moduleV1.lastVersion());

      // create module V2
      const { module: moduleV2 } = await deployTestModule();
      // register module V2
      await registry.registerModule(moduleV2.contractAddress, formatBytes32String("V2"));
      // create upgraders
      const toAdd = modulesToAdd(moduleV2.contractAddress);
      const upgrader1 = await deployer.deploy(SimpleUpgrader, {},
        registry.contractAddress, lockStorage.contractAddress, [moduleV1.contractAddress], toAdd);
      const upgrader2 = await deployer.deploy(SimpleUpgrader, {},
        registry.contractAddress, lockStorage.contractAddress, [moduleV1.contractAddress], toAdd);
      await registry.registerModule(upgrader1.contractAddress, formatBytes32String("V1toV2_1"));
      await registry.registerModule(upgrader2.contractAddress, formatBytes32String("V1toV2_2"));

      // upgrade from V1 to V2
      let txReceipt;
      const params1 = [wallet.contractAddress, upgrader1.contractAddress];
      const params2 = [wallet.contractAddress, upgrader2.contractAddress];
      // if no module is added and all modules are removed, the upgrade should fail
      if (toAdd.length === 0) {
        if (relayed) {
          txReceipt = await manager.relay(moduleV1, "addModule", params2, wallet, [owner]);
          const { success } = (await utils.parseLogs(txReceipt, relayerV1, "TransactionExecuted"))[0];
          assert.isTrue(!success, "Relayed upgrade to 0 module should have failed.");
        } else {
          assert.revert(moduleV1.from(owner).addModule(...params2));
        }
        return;
      }
      if (relayed) {
        txReceipt = await manager.relay(moduleV1, "addModule", params1, wallet, [owner]);
        const { success } = (await utils.parseLogs(txReceipt, relayerV1, "TransactionExecuted"))[0];
        assert.isTrue(success, "Relayed tx should only have succeeded");
      } else {
        const tx = await moduleV1.from(owner).addModule(...params1);
        txReceipt = await moduleV1.verboseWaitForTransaction(tx);
      }

      // test event ordering
      const logs = utils.parseLogs(txReceipt, wallet, "AuthorisedModule");
      const upgraderAuthorisedLogIndex = logs.findIndex((e) => e.module === upgrader1.contractAddress && e.value === true);
      const upgraderUnauthorisedLogIndex = logs.findIndex((e) => e.module === upgrader1.contractAddress && e.value === false);
      assert.isBelow(upgraderAuthorisedLogIndex, upgraderUnauthorisedLogIndex,
        "AuthorisedModule(upgrader, false) should come after AuthorisedModule(upgrader, true)");

      // test if the upgrade worked
      const isV1Authorised = await wallet.authorised(moduleV1.contractAddress);
      const isV2Authorised = await wallet.authorised(moduleV2.contractAddress);
      const isUpgraderAuthorised = await wallet.authorised(upgrader1.contractAddress);
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
      versionManager = await deployer.deploy(VersionManager, {},
        registry.contractAddress,
        lockStorage.contractAddress,
        guardianStorage.contractAddress,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero);
      guardianManager = await deployer.deploy(GuardianManager, {},
        lockStorage.contractAddress,
        guardianStorage.contractAddress,
        versionManager.contractAddress,
        24, 12);
      lockManager = await deployer.deploy(LockManager, {},
        lockStorage.contractAddress,
        guardianStorage.contractAddress,
        versionManager.contractAddress,
        24 * 5);
      recoveryManager = await deployer.deploy(RecoveryManager, {},
        lockStorage.contractAddress,
        guardianStorage.contractAddress,
        versionManager.contractAddress,
        36, 24 * 5);
      relayerManager = await deployer.deploy(RelayerManager, {},
        lockStorage.contractAddress,
        guardianStorage.contractAddress,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        versionManager.contractAddress);
      manager.setRelayerManager(relayerManager);

      // Setup the wallet with the initial set of modules
      await versionManager.addVersion([
        guardianManager.contractAddress,
        lockManager.contractAddress,
        recoveryManager.contractAddress,
        relayerManager.contractAddress,
      ], []);
      await wallet.init(owner, [versionManager.contractAddress]);
      await versionManager.from(owner).upgradeWallet(wallet.contractAddress, await versionManager.lastVersion());
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian);

      // Setup module v2 for the upgrade
      const { module } = await deployTestModule();
      moduleV2 = module;
      await registry.registerModule(moduleV2.contractAddress, formatBytes32String("V2"));
    });

    it("should not be able to upgrade if wallet is locked by guardian", async () => {
      const upgrader = await deployer.deploy(SimpleUpgrader, {},
        lockStorage.contractAddress, registry.contractAddress, [versionManager.contractAddress], [moduleV2.contractAddress]);
      await registry.registerModule(upgrader.contractAddress, formatBytes32String("V1toV2"));

      // Guardian locks the wallet
      await lockManager.from(guardian).lock(wallet.contractAddress);

      // Try to upgrade while wallet is locked
      await assert.revertWith(versionManager.from(owner).addModule(wallet.contractAddress, upgrader.contractAddress), "BF: wallet locked");

      // Check wallet is still locked
      const locked = await lockManager.isLocked(wallet.contractAddress);
      assert.isTrue(locked);
      // Check upgrade failed
      const isV1Authorised = await wallet.authorised(versionManager.contractAddress);
      const isV2Authorised = await wallet.authorised(moduleV2.contractAddress);
      assert.isTrue(isV1Authorised);
      assert.isFalse(isV2Authorised);
    });

    it("should not be able to upgrade if wallet is under recovery", async () => {
      const upgrader = await deployer.deploy(
        SimpleUpgrader,
        {},
        lockStorage.contractAddress,
        registry.contractAddress,
        [versionManager.contractAddress],
        [moduleV2.contractAddress],
      );
      await registry.registerModule(upgrader.contractAddress, formatBytes32String("V1toV2"));

      // Put the wallet under recovery
      await manager.relay(recoveryManager, "executeRecovery", [wallet.contractAddress, newowner], wallet, [guardian]);
      // check that the wallet is locked
      let locked = await lockManager.isLocked(wallet.contractAddress);
      assert.isTrue(locked, "wallet should be locked");

      // Try to upgrade while wallet is under recovery
      await assert.revertWith(versionManager.from(owner).addModule(wallet.contractAddress, upgrader.contractAddress), "BF: wallet locked");

      // Check wallet is still locked
      locked = await lockManager.isLocked(wallet.contractAddress);
      assert.isTrue(locked, "wallet should still be locked");

      // Check upgrade failed
      const isV1Authorised = await wallet.authorised(versionManager.contractAddress);
      const isV2Authorised = await wallet.authorised(moduleV2.contractAddress);
      assert.isTrue(isV1Authorised);
      assert.isFalse(isV2Authorised);
    });
  });
});
