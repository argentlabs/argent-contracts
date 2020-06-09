/* global accounts */
const ethers = require("ethers");

const Wallet = require("../build/BaseWallet");
const OldWallet = require("../build/LegacyBaseWallet");
const Module = require("../build/TestModuleRelayer");
const OldTestModule = require("../build/OldTestModule");
const NewTestModule = require("../build/NewTestModule");
const Registry = require("../build/ModuleRegistry");
const SimpleUpgrader = require("../build/SimpleUpgrader");

const TestManager = require("../utils/test-manager");

describe("BaseWallet", function () {
  this.timeout(10000);

  const manager = new TestManager();

  const owner = accounts[1].signer;
  const nonowner = accounts[2].signer;

  let deployer;
  let wallet;
  let registry;
  let module1;
  let module2;
  let module3;
  let oldModule;
  let newModule;

  before(async () => {
    deployer = manager.newDeployer();
    registry = await deployer.deploy(Registry);
    module1 = await deployer.deploy(Module, {}, registry.contractAddress, true, 42);
    module2 = await deployer.deploy(Module, {}, registry.contractAddress, false, 42);
    module3 = await deployer.deploy(Module, {}, registry.contractAddress, true, 42);
    oldModule = await deployer.deploy(OldTestModule, {}, registry.contractAddress);
    newModule = await deployer.deploy(NewTestModule, {}, registry.contractAddress);
  });

  beforeEach(async () => {
    wallet = await deployer.deploy(Wallet);
  });

  describe("Old and New BaseWallets", () => {
    describe("wallet init", () => {
      it("should create a wallet with the correct owner", async () => {
        let walletOwner = await wallet.owner();
        assert.equal(walletOwner, "0x0000000000000000000000000000000000000000", "owner should be null before init");
        await wallet.init(owner.address, [module1.contractAddress]);
        walletOwner = await wallet.owner();
        assert.equal(walletOwner, owner.address, "owner should be the owner after init");
      });

      it("should create a wallet with the correct modules", async () => {
        await wallet.init(owner.address, [module1.contractAddress, module2.contractAddress]);
        const module1IsAuthorised = await wallet.authorised(module1.contractAddress);
        const module2IsAuthorised = await wallet.authorised(module2.contractAddress);
        const module3IsAuthorised = await wallet.authorised(module3.contractAddress);
        assert.equal(module1IsAuthorised, true, "module1 should be authorised");
        assert.equal(module2IsAuthorised, true, "module2 should be authorised");
        assert.equal(module3IsAuthorised, false, "module3 should not be authorised");
      });

      it("should not reinitialize a wallet", async () => {
        await wallet.init(owner.address, [module1.contractAddress]);
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

      it("should not let a module set the owner to address(0)", async () => {
        await wallet.init(owner.address, [module1.contractAddress]);
        await assert.revertWith(module1.invalidOwnerChange(wallet.contractAddress), "BW: address cannot be null");
      });
    });

    describe("Static calls", () => {
      it("should delegate static calls to the modules", async () => {
        await wallet.init(owner.address, [module1.contractAddress]);
        const module1IsAuthorised = await wallet.authorised(module1.contractAddress);
        assert.equal(module1IsAuthorised, true, "module1 should be authorised");
        const walletAsModule = deployer.wrapDeployedContract(Module, wallet.contractAddress);
        const boolVal = await walletAsModule.contract.getBoolean();
        const uintVal = await walletAsModule.contract.getUint();
        const addressVal = await walletAsModule.contract.getAddress(nonowner.address);
        assert.equal(boolVal, true, "should have the correct bool");
        assert.equal(uintVal, 42, "should have the correct uint");
        assert.equal(addressVal, nonowner.address, "should have the address");
      });

      it("should not delegate static calls to unauthorised modules ", async () => {
        await wallet.init(owner.address, [module1.contractAddress]);
        const module1IsAuthorised = await wallet.authorised(module1.contractAddress);
        assert.equal(module1IsAuthorised, true, "module1 should be authorised");
        const module2IsAuthorised = await wallet.authorised(module2.contractAddress);
        assert.equal(module2IsAuthorised, false, "module2 should not be authorised");
        await assert.revertWith(module1.enableStaticCalls(wallet.contractAddress, module2.contractAddress),
          "BW: must be an authorised module for static call");
      });

      it("should not delegate static calls to no longer authorised modules ", async () => {
        await wallet.init(owner.address, [module2.contractAddress, module1.contractAddress]);
        let module1IsAuthorised = await wallet.authorised(module1.contractAddress);
        assert.equal(module1IsAuthorised, true, "module1 should be authorised");

        // removing module 1
        const upgrader = await deployer.deploy(SimpleUpgrader, {}, registry.contractAddress, [module1.contractAddress], []);
        await registry.registerModule(upgrader.contractAddress, ethers.utils.formatBytes32String("Removing module1"));
        await module1.from(owner).addModule(wallet.contractAddress, upgrader.contractAddress);
        module1IsAuthorised = await wallet.authorised(module1.contractAddress);
        assert.equal(module1IsAuthorised, false, "module1 should not be authorised");

        // trying to execute static call delegated to module1 (it should fail)
        const walletAsModule = deployer.wrapDeployedContract(Module, wallet.contractAddress);
        await assert.revertWith(walletAsModule.contract.getBoolean(), "BW: must be an authorised module for static call");
      });
    });
  });

  describe("New BaseWallet", () => {
    it("should work with old modules", async () => {
      await wallet.init(owner.address, [oldModule.contractAddress]);
      await oldModule.callDapp(wallet.contractAddress);
      await oldModule.callDapp2(wallet.contractAddress);
    });
    it("should work with new modules", async () => {
      await wallet.init(owner.address, [newModule.contractAddress]);
      await newModule.callDapp(wallet.contractAddress);
      await newModule.callDapp2(wallet.contractAddress, 2, true);
    });
    it("should bubble the reason message up when reverting", async () => {
      await wallet.init(owner.address, [newModule.contractAddress]);
      const reason = "I'm hereby reverting this transaction using a reason message that is longer than 32 bytes!";
      try {
        await newModule.fail(wallet.contractAddress, reason);
      } catch (e) {
        assert.isTrue(await manager.isRevertReason(e, reason), "invalid reason message");
      }
    });
  });

  describe("Old BaseWallet", () => {
    it("should work with new modules", async () => {
      const oldWallet = await deployer.deploy(OldWallet);
      await oldWallet.init(owner.address, [oldModule.contractAddress, newModule.contractAddress]);
      await newModule.callDapp(oldWallet.contractAddress);
      await newModule.callDapp2(oldWallet.contractAddress, 2, false);
      await assert.revert(newModule.fail(oldWallet.contractAddress, "just because"));
    });
  });
});
