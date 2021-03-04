/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");
const TruffleContract = require("@truffle/contract");

const OldWalletV13Contract = require("../build-legacy/v1.3.0/BaseWallet");
const OldWalletV16Contract = require("../build-legacy/v1.6.0/BaseWallet");

const OldWalletV13 = TruffleContract(OldWalletV13Contract);
const OldWalletV16 = TruffleContract(OldWalletV16Contract);

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");

const Registry = artifacts.require("ModuleRegistry");
const GuardianStorage = artifacts.require("GuardianStorage");
const TransferStorage = artifacts.require("TransferStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const UniswapV2Router01 = artifacts.require("DummyUniV2Router");

const { getBalance } = require("../utils/utilities.js");

const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

contract("BaseWallet", (accounts) => {
  const owner = accounts[1];

  let wallet;
  let walletImplementation;
  let registry;
  let module1;
  let module2;
  let module3;
  let feature1;
  let guardianStorage;
  let transferStorage;
  let dappRegistry;
  let uniswapRouter;

  async function deployTestModule() {
    const _module = await ArgentModule.new(
      registry.address,
      guardianStorage.address,
      transferStorage.address,
      dappRegistry.address,
      uniswapRouter.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      RECOVERY_PERIOD,
      LOCK_PERIOD);

    return _module;
  }

  before(async () => {
    OldWalletV13.defaults({ from: accounts[0] });
    OldWalletV13.setProvider(web3.currentProvider);
    OldWalletV16.defaults({ from: accounts[0] });
    OldWalletV16.setProvider(web3.currentProvider);

    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();
    dappRegistry = await DappRegistry.new(0);
    uniswapRouter = await UniswapV2Router01.new();

    module1 = await deployTestModule();
    module2 = await deployTestModule();
    module3 = await deployTestModule();
    walletImplementation = await BaseWallet.new();
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
  });

  describe("Registering modules", () => {
    it("should register a module with the correct info", async () => {
      const name = ethers.utils.formatBytes32String("module1");
      await registry.registerModule(module1.address, name);
      const isRegistered = await registry.contract.methods["isRegisteredModule(address)"](module1.address).call();
      assert.isTrue(isRegistered);
      const info = await registry.moduleInfo(module1.address);
      assert.equal(name, info);
    });

    it("should deregister a module", async () => {
      const name = ethers.utils.formatBytes32String("module2");
      await registry.registerModule(module2.address, name);
      await registry.deregisterModule(module2.address);
      const isRegistered = await registry.contract.methods["isRegisteredModule(address)"](module2.address).call();
      assert.isFalse(isRegistered);
    });

    it("should register an upgrader with the correct info", async () => {
      const name = ethers.utils.formatBytes32String("upgrader1");
      await registry.registerUpgrader(module1.address, name);
      const isRegistered = await registry.isRegisteredUpgrader(module1.address);
      assert.isTrue(isRegistered);
      const info = await registry.upgraderInfo(module1.address);
      assert.equal(name, info);
    });

    it("should deregister an upgrader", async () => {
      const name = ethers.utils.formatBytes32String("upgrader2");
      await registry.registerUpgrader(module2.address, name);

      await registry.deregisterUpgrader(module2.address);
      const isRegistered = await registry.isRegisteredUpgrader(module2.address);
      assert.isFalse(isRegistered, "upgrader should be deregistered");
    });

    it("should not let a non-module deauthorise a module", async () => {
      await wallet.init(owner, [module1.address]);
      await truffleAssert.reverts(wallet.authoriseModule(module1.address, false), "BW: sender not authorized");
    });
  });

  describe("Initialize Wallets", () => {
    it("should create a wallet with the correct owner", async () => {
      let walletOwner = await wallet.owner();
      assert.equal(walletOwner, "0x0000000000000000000000000000000000000000");
      await wallet.init(owner, [module1.address]);
      walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner);
    });

    it("should create a wallet with the correct modules", async () => {
      await wallet.init(owner, [module1.address, module2.address]);
      const module1IsAuthorised = await wallet.authorised(module1.address);
      const module2IsAuthorised = await wallet.authorised(module2.address);
      const module3IsAuthorised = await wallet.authorised(module3.address);
      assert.equal(module1IsAuthorised, true);
      assert.equal(module2IsAuthorised, true);
      assert.equal(module3IsAuthorised, false);
    });

    it("should not reinitialize a wallet", async () => {
      await wallet.init(owner, [module1.address]);
      await truffleAssert.reverts(wallet.init(owner, [module1.address]), "BW: wallet already initialised");
    });

    it("should not initialize a wallet with no module", async () => {
      await truffleAssert.reverts(wallet.init(owner, []), "BW: empty modules");
    });

    it("should not initialize a wallet with duplicate modules", async () => {
      await truffleAssert.reverts(wallet.init(owner, [module1.address, module1.address]), "BW: module is already added");
    });
  });

  describe("Receiving ETH", () => {
    it("should accept ETH", async () => {
      const before = await getBalance(wallet.address);
      await wallet.send(50000000);
      const after = await getBalance(wallet.address);
      assert.equal(after.sub(before).toNumber(), 50000000, "should have received ETH");
    });

    it("should accept ETH with data", async () => {
      const before = await getBalance(wallet.address);
      await web3.eth.sendTransaction({ from: accounts[0], to: wallet.address, data: "0x1234", value: 50000000 });
      const after = await getBalance(wallet.address);
      assert.equal(after.sub(before).toNumber(), 50000000, "should have received ETH");
    });
  });

  describe.skip("Old BaseWallet V1.3", () => {
    it("should work with new modules", async () => {
      const oldWallet = await OldWalletV13.new();
      await oldWallet.init(owner, [module1.address]);
      await feature1.callDapp(oldWallet.address);
      await feature1.callDapp2(oldWallet.address, 2, false);
      await truffleAssert.reverts(feature1.fail(oldWallet.address, "just because"));
    });
  });

  describe.skip("Old BaseWallet V1.6", () => {
    it("should work with new modules", async () => {
      const oldWallet = await OldWalletV16.new();
      await oldWallet.init(owner, [module1.address]);
      await feature1.callDapp(oldWallet.address);
      await feature1.callDapp2(oldWallet.address, 2, true);
      await truffleAssert.reverts(feature1.fail(oldWallet.address, "just because"));
    });
  });
});
