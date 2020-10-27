/* global accounts */
const ethers = require("ethers");
const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");
const OldWalletV16 = require("../build-legacy/v1.6.0/BaseWallet");
const OldWalletV13 = require("../build-legacy/v1.3.0/BaseWallet");
const VersionManager = require("../build/VersionManager");
const Registry = require("../build/ModuleRegistry");
const SimpleUpgrader = require("../build/SimpleUpgrader");
const GuardianStorage = require("../build/GuardianStorage");
const LockStorage = require("../build/LockStorage");
const TestFeature = require("../build/TestFeature");

const TestManager = require("../utils/test-manager");

describe("BaseWallet", function () {
  this.timeout(100000);

  const manager = new TestManager();

  const owner = accounts[1].signer;
  const nonowner = accounts[2].signer;

  let deployer;
  let wallet;
  let walletImplementation;
  let registry;
  let module1;
  let module2;
  let module3;
  let feature1;
  let guardianStorage;
  let lockStorage;

  async function deployTestModule() {
    const module = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    const feature = await deployer.deploy(TestFeature, {},
      lockStorage.contractAddress,
      module.contractAddress,
      42);
    await module.addVersion([feature.contractAddress], []);
    return { module, feature };
  }

  before(async () => {
    deployer = manager.newDeployer();
    registry = await deployer.deploy(Registry);
    guardianStorage = await deployer.deploy(GuardianStorage);
    lockStorage = await deployer.deploy(LockStorage);
    const mod = await deployTestModule();
    [module1, feature1] = [mod.module, mod.feature];
    module2 = (await deployTestModule()).module;
    module3 = (await deployTestModule()).module;
    walletImplementation = await deployer.deploy(BaseWallet);
  });

  beforeEach(async () => {
    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
  });

  describe("Registering modules", () => {
    it("should register a module with the correct info", async () => {
      const name = ethers.utils.formatBytes32String("module1");
      await registry.registerModule(module1.contractAddress, name);
      const isRegistered = await registry["isRegisteredModule(address)"](module1.contractAddress);
      assert.isTrue(isRegistered, "module should be registered");
      const info = await registry.moduleInfo(module1.contractAddress);
      assert.equal(name, info, "name should be correct");
    });

    it("should deregister a module", async () => {
      const name = ethers.utils.formatBytes32String("module2");
      await registry.registerModule(module2.contractAddress, name);
      let isRegistered = await registry["isRegisteredModule(address)"](module2.contractAddress);
      assert.isTrue(isRegistered, "module should be registered");
      await registry.deregisterModule(module2.contractAddress);
      isRegistered = await registry["isRegisteredModule(address)"](module2.contractAddress);
      assert.isFalse(isRegistered, "module should be deregistered");
    });

    it("should register an upgrader with the correct info", async () => {
      const name = ethers.utils.formatBytes32String("upgrader1");
      await registry.registerUpgrader(module1.contractAddress, name);
      const isRegistered = await registry.isRegisteredUpgrader(module1.contractAddress);
      assert.isTrue(isRegistered, "module should be registered");
      const info = await registry.upgraderInfo(module1.contractAddress);
      assert.equal(name, info, "name should be correct");
    });

    it("should deregister an upgrader", async () => {
      const name = ethers.utils.formatBytes32String("upgrader2");
      await registry.registerUpgrader(module2.contractAddress, name);
      let isRegistered = await registry.isRegisteredUpgrader(module2.contractAddress);
      assert.isTrue(isRegistered, "upgrader should be registered");
      await registry.deregisterUpgrader(module2.contractAddress);
      isRegistered = await registry.isRegisteredUpgrader(module2.contractAddress);
      assert.isFalse(isRegistered, "upgrader should be deregistered");
    });
  });

  describe("Initialize Wallets", () => {
    describe("wallet init", () => {
      it("should create a wallet with the correct owner", async () => {
        let walletOwner = await wallet.owner();
        assert.equal(walletOwner, "0x0000000000000000000000000000000000000000", "owner should be null before init");
        await wallet.init(owner.address, [module1.contractAddress]);
        await module1.from(owner).upgradeWallet(wallet.contractAddress, await module1.lastVersion());
        walletOwner = await wallet.owner();
        assert.equal(walletOwner, owner.address, "owner should be the owner after init");
      });

      it("should create a wallet with the correct modules", async () => {
        await wallet.init(owner.address, [module1.contractAddress, module2.contractAddress]);
        await module1.from(owner).upgradeWallet(wallet.contractAddress, await module1.lastVersion());
        await module2.from(owner).upgradeWallet(wallet.contractAddress, await module2.lastVersion());
        const module1IsAuthorised = await wallet.authorised(module1.contractAddress);
        const module2IsAuthorised = await wallet.authorised(module2.contractAddress);
        const module3IsAuthorised = await wallet.authorised(module3.contractAddress);
        assert.equal(module1IsAuthorised, true, "module1 should be authorised");
        assert.equal(module2IsAuthorised, true, "module2 should be authorised");
        assert.equal(module3IsAuthorised, false, "module3 should not be authorised");
      });

      it("should not reinitialize a wallet", async () => {
        await wallet.init(owner.address, [module1.contractAddress]);
        await module1.from(owner).upgradeWallet(wallet.contractAddress, await module1.lastVersion());
        await assert.revertWith(wallet.init(owner.address, [module1.contractAddress]), "BW: wallet already initialised");
      });

      it("should not initialize a wallet with no module", async () => {
        await assert.revertWith(wallet.init(owner.address, []), "BW: construction requires at least 1 module");
      });

      it("should not initialize a wallet with duplicate modules", async () => {
        await assert.revertWith(wallet.init(owner.address, [module1.contractAddress, module1.contractAddress]), "BW: module is already added");
      });
    });

    describe("Receiving ETH", () => {
      it("should accept ETH", async () => {
        const before = await deployer.provider.getBalance(wallet.contractAddress);
        await nonowner.sendTransaction({ to: wallet.contractAddress, value: 50000000 });
        const after = await deployer.provider.getBalance(wallet.contractAddress);
        assert.equal(after.sub(before).toNumber(), 50000000, "should have received ETH");
      });

      it("should accept ETH with data", async () => {
        const before = await deployer.provider.getBalance(wallet.contractAddress);
        await nonowner.sendTransaction({ to: wallet.contractAddress, value: 50000000, data: 0x1234 });
        const after = await deployer.provider.getBalance(wallet.contractAddress);
        assert.equal(after.sub(before).toNumber(), 50000000, "should have received ETH");
      });
    });

    describe("Authorisations", () => {
      it("should not let a non-module deauthorise a module", async () => {
        await wallet.init(owner.address, [module1.contractAddress]);
        await assert.revertWith(wallet.authoriseModule(module1.contractAddress, false), "BW: msg.sender not an authorized module");
      });

      it("should not let a feature set the owner to address(0)", async () => {
        await wallet.init(owner.address, [module1.contractAddress]);
        await module1.from(owner).upgradeWallet(wallet.contractAddress, await module1.lastVersion());

        await assert.revertWith(feature1.invalidOwnerChange(wallet.contractAddress), "BW: address cannot be null");
      });
    });

    describe("Static calls", () => {
      it("should delegate static calls to the modules", async () => {
        await wallet.init(owner.address, [module1.contractAddress]);
        await module1.from(owner).upgradeWallet(wallet.contractAddress, await module1.lastVersion());
        const module1IsAuthorised = await wallet.authorised(module1.contractAddress);
        assert.equal(module1IsAuthorised, true, "module1 should be authorised");
        const walletAsFeature = deployer.wrapDeployedContract(TestFeature, wallet.contractAddress);
        const boolVal = await walletAsFeature.contract.getBoolean();
        const uintVal = await walletAsFeature.contract.getUint();
        const addressVal = await walletAsFeature.contract.getAddress(nonowner.address);
        assert.equal(boolVal, true, "should have the correct bool");
        assert.equal(uintVal, 42, "should have the correct uint");
        assert.equal(addressVal, nonowner.address, "should have the address");
      });

      it("should not delegate static calls to no longer authorised modules ", async () => {
        await wallet.init(owner.address, [module1.contractAddress, module2.contractAddress]);
        await module1.from(owner).upgradeWallet(wallet.contractAddress, await module1.lastVersion());
        let module1IsAuthorised = await wallet.authorised(module1.contractAddress);
        assert.equal(module1IsAuthorised, true, "module1 should be authorised");

        // removing module 1
        const upgrader = await deployer.deploy(SimpleUpgrader, {},
          registry.contractAddress, lockStorage.contractAddress, [module1.contractAddress], []);
        await registry.registerModule(upgrader.contractAddress, ethers.utils.formatBytes32String("Removing module1"));
        await module1.from(owner).addModule(wallet.contractAddress, upgrader.contractAddress);
        module1IsAuthorised = await wallet.authorised(module1.contractAddress);
        assert.equal(module1IsAuthorised, false, "module1 should not be authorised");

        // trying to execute static call delegated to module1 (it should fail)
        const walletAsModule = deployer.wrapDeployedContract(TestFeature, wallet.contractAddress);
        await assert.revertWith(walletAsModule.contract.getBoolean(), "BW: must be an authorised module for static call");
      });
    });
  });

  describe("Old BaseWallet V1.3", () => {
    it("should work with new modules", async () => {
      const oldWallet = await deployer.deploy(OldWalletV13);
      await oldWallet.init(owner.address, [module1.contractAddress]);
      await module1.from(owner).upgradeWallet(oldWallet.contractAddress, await module1.lastVersion());
      await feature1.callDapp(oldWallet.contractAddress);
      await feature1.callDapp2(oldWallet.contractAddress, 2, false);
      await assert.revert(feature1.fail(oldWallet.contractAddress, "just because"));
    });
  });

  describe("Old BaseWallet V1.6", () => {
    it("should work with new modules", async () => {
      const oldWallet = await deployer.deploy(OldWalletV16);
      await oldWallet.init(owner.address, [module1.contractAddress]);
      await module1.from(owner).upgradeWallet(oldWallet.contractAddress, await module1.lastVersion());
      await feature1.callDapp(oldWallet.contractAddress);
      await feature1.callDapp2(oldWallet.contractAddress, 2, true);
      await assert.revert(feature1.fail(oldWallet.contractAddress, "just because"));
    });
  });
});
