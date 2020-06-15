/* global accounts, utils */
const etherlime = require("etherlime-lib");
const {
  keccak256, toUtf8Bytes, formatBytes32String, parseBytes32String,
} = require("ethers").utils;

const Wallet = require("../build/BaseWallet");
const OnlyOwnerModule = require("../build/TestOnlyOwnerModule");
const Module = require("../build/TestModuleRelayer");
const SimpleUpgrader = require("../build/SimpleUpgrader");
const Registry = require("../build/ModuleRegistry");

const TestManager = require("../utils/test-manager");

const IS_ONLY_OWNER_MODULE = keccak256(toUtf8Bytes("isOnlyOwnerModule()")).slice(0, 10);

describe("SimpleUpgrader", function () {
  this.timeout(10000);

  const manager = new TestManager();

  const owner = accounts[1].signer;
  let deployer;
  let registry;

  beforeEach(async () => {
    deployer = new etherlime.EtherlimeGanacheDeployer(accounts[0].secretKey);
    registry = await deployer.deploy(Registry);
  });

  describe("Registering modules", () => {
    it("should register modules in the registry", async () => {
      const name = "test_1.1";
      const initialModule = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
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
      const initialModule = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
      const moduleToAdd = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
      // register module
      await registry.registerModule(initialModule.contractAddress, formatBytes32String("initial"));
      await registry.registerModule(moduleToAdd.contractAddress, formatBytes32String("added"));
      // create wallet with initial module
      const wallet = await deployer.deploy(Wallet);

      await wallet.init(owner.address, [initialModule.contractAddress]);
      let isAuthorised = await wallet.authorised(initialModule.contractAddress);
      assert.equal(isAuthorised, true, "initial module should be authorised");
      // add module to wallet
      await initialModule.from(owner).addModule(wallet.contractAddress, moduleToAdd.contractAddress, { gasLimit: 1000000 });
      isAuthorised = await wallet.authorised(moduleToAdd.contractAddress);
      assert.equal(isAuthorised, true, "added module should be authorised");
    });

    it("should block addition of unregistered modules to a wallet", async () => {
      // create modules
      const initialModule = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
      const moduleToAdd = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
      // register initial module only
      await registry.registerModule(initialModule.contractAddress, formatBytes32String("initial"));
      // create wallet with initial module
      const wallet = await deployer.deploy(Wallet);
      await wallet.init(owner.address, [initialModule.contractAddress]);
      let isAuthorised = await wallet.authorised(initialModule.contractAddress);
      assert.equal(isAuthorised, true, "initial module should be authorised");
      // try (and fail) to add moduleToAdd to wallet
      await assert.revert(initialModule.from(owner).addModule(wallet.contractAddress, moduleToAdd.contractAddress, { gasLimit: 1000000 }));
      isAuthorised = await wallet.authorised(moduleToAdd.contractAddress);
      assert.equal(isAuthorised, false, "unregistered module should not be authorised");
    });

    it("should not be able to upgrade to unregistered module", async () => {
      // create module V1
      const moduleV1 = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
      // register module V1
      await registry.registerModule(moduleV1.contractAddress, formatBytes32String("V1"));
      // create wallet with module V1
      const wallet = await deployer.deploy(Wallet);
      await wallet.init(owner.address, [moduleV1.contractAddress]);
      // create module V2
      const moduleV2 = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
      // create upgrader
      const upgrader = await deployer.deploy(SimpleUpgrader, {}, registry.contractAddress, [moduleV1.contractAddress], [moduleV2.contractAddress]);
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
    async function testUpgradeModule({ relayed, useOnlyOwnerModule, modulesToAdd = (moduleV2) => [moduleV2] }) {
      // create module V1
      let moduleV1;
      if (useOnlyOwnerModule) {
        moduleV1 = await deployer.deploy(OnlyOwnerModule, {}, registry.contractAddress);
      } else {
        moduleV1 = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
      }
      // register module V1
      await registry.registerModule(moduleV1.contractAddress, formatBytes32String("V1"));
      // create wallet with module V1
      const wallet = await deployer.deploy(Wallet);
      await wallet.init(owner.address, [moduleV1.contractAddress]);
      // create module V2
      const moduleV2 = await deployer.deploy(Module, {}, registry.contractAddress, false, 0);
      // register module V2
      await registry.registerModule(moduleV2.contractAddress, formatBytes32String("V2"));
      // create upgrader
      const toAdd = modulesToAdd(moduleV2.contractAddress);
      const upgrader = await deployer.deploy(SimpleUpgrader, {}, registry.contractAddress, [moduleV1.contractAddress], toAdd);
      await registry.registerModule(upgrader.contractAddress, formatBytes32String("V1toV2"));
      // check that module V1 can be used to add the upgrader module
      if (useOnlyOwnerModule) {
        assert.equal(await moduleV1.isOnlyOwnerModule(), IS_ONLY_OWNER_MODULE);
      }

      // upgrade from V1 to V2
      let txReceipt;
      const params = [wallet.contractAddress, upgrader.contractAddress];

      // if no module is added, the upgrade should fail
      if (toAdd.length === 0) {
        if (relayed) {
          txReceipt = await manager.relay(moduleV1, "addModule", params, wallet, [owner]);
          assert.isTrue(!txReceipt.events.find((e) => e.event === "TransactionExecuted").args.success,
            "Relayed upgrade to 0 module should have failed.");
        } else {
          assert.revert(moduleV1.from(owner).addModule(...params, { gasLimit: 1000000 }));
        }
        return;
      }

      if (relayed) {
        txReceipt = await manager.relay(moduleV1, "addModule", params, wallet, [owner]);
        assert.equal(txReceipt.events.find((e) => e.event === "TransactionExecuted").args.success, useOnlyOwnerModule,
          "Relayed tx should only have succeeded if an OnlyOwnerModule was used");
      } else {
        const tx = await moduleV1.from(owner).addModule(...params, { gasLimit: 1000000 });
        txReceipt = await moduleV1.verboseWaitForTransaction(tx);
      }

      // test event ordering
      const logs = utils.parseLogs(txReceipt, wallet, "AuthorisedModule");
      const upgraderAuthorisedLogIndex = logs.findIndex((e) => e.module === upgrader.contractAddress && e.value === true);
      const upgraderUnauthorisedLogIndex = logs.findIndex((e) => e.module === upgrader.contractAddress && e.value === false);
      if (!relayed || useOnlyOwnerModule) {
        assert.isBelow(upgraderAuthorisedLogIndex, upgraderUnauthorisedLogIndex,
          "AuthorisedModule(upgrader, false) should come after AuthorisedModule(upgrader, true)");
      } else {
        assert.equal(upgraderUnauthorisedLogIndex, -1, "AuthorisedModule(upgrader, false) should not have been emitted");
        assert.equal(upgraderAuthorisedLogIndex, -1, "AuthorisedModule(upgrader, true) should not have been emitted");
      }

      // test if the upgrade worked
      const isV1Authorised = await wallet.authorised(moduleV1.contractAddress);
      const isV2Authorised = await wallet.authorised(moduleV2.contractAddress);
      const isUpgraderAuthorised = await wallet.authorised(upgrader.contractAddress);
      const numModules = await wallet.modules();
      assert.equal(isV1Authorised, relayed && !useOnlyOwnerModule, "moduleV1 should only be unauthorised if the upgrade went through");
      assert.equal(isV2Authorised, !relayed || useOnlyOwnerModule, "moduleV2 should only be authorised if the upgrade went through");
      assert.equal(isUpgraderAuthorised, false, "upgrader should not be authorised");
      assert.equal(numModules, 1, "only one module (moduleV2) should be authorised");
    }

    it("should upgrade modules (blockchain tx)", async () => {
      await testUpgradeModule({ relayed: false, useOnlyOwnerModule: false });
    });

    it("should upgrade modules (not using OnlyOwnerModule, relayed tx)", async () => {
      await testUpgradeModule({ relayed: true, useOnlyOwnerModule: false });
    });

    it("should upgrade modules (using OnlyOwnerModule, relayed tx)", async () => {
      await testUpgradeModule({ relayed: true, useOnlyOwnerModule: true });
    });

    it("should ignore duplicate modules in upgrader (blockchain tx)", async () => {
      // we intentionally try to add moduleV2 twice to check that it will only be authorised once
      await testUpgradeModule({ relayed: false, useOnlyOwnerModule: false, modulesToAdd: (v2) => [v2, v2] });
    });

    it("should not upgrade to 0 module (blockchain tx)", async () => {
      // we intentionally try to add 0 module, this should fail
      await testUpgradeModule({ relayed: false, useOnlyOwnerModule: true, modulesToAdd: (v2) => [] }); // eslint-disable-line no-unused-vars
    });

    it("should not upgrade to 0 module (relayed tx)", async () => {
      // we intentionally try to add 0 module, this should fail
      await testUpgradeModule({ relayed: true, useOnlyOwnerModule: true, modulesToAdd: (v2) => [] }); // eslint-disable-line no-unused-vars
    });
  });
});
