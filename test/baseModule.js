/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");

const Registry = artifacts.require("ModuleRegistry");
const ERC20 = artifacts.require("TestERC20");
const NonCompliantERC20 = artifacts.require("NonCompliantERC20");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const UniswapV2Router01 = artifacts.require("DummyUniV2Router");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");

const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 2;
const SECURITY_WINDOW = 2;
const LOCK_PERIOD = 4;
const RECOVERY_PERIOD = 4;

contract("BaseModule", (accounts) => {
  const owner = accounts[1];
  const guardian = accounts[2];
  const relayer = accounts[9];

  let registry;
  let transferStorage;
  let guardianStorage;
  let module;
  let dappRegistry;
  let token;
  let wallet;

  beforeEach(async () => {
    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();
    dappRegistry = await DappRegistry.new(0);

    const uniswapRouter = await UniswapV2Router01.new();

    module = await ArgentModule.new(
      registry.address,
      guardianStorage.address,
      transferStorage.address,
      dappRegistry.address,
      uniswapRouter.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      RECOVERY_PERIOD,
      LOCK_PERIOD);

    await registry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));
    await dappRegistry.addDapp(0, relayer, ZERO_ADDRESS);

    const walletImplementation = await BaseWallet.new();
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);
    await module.addGuardian(wallet.address, guardian, { from: owner });

    token = await ERC20.new([owner], 10, 18);
  });

  describe("Core functionality", async () => {
    it("should not be able to init module if not called by wallet", async () => {
      await truffleAssert.reverts(module.init(wallet.address), "BM: caller must be wallet");
    });

    it("should not be able to unlock module which is not locked", async () => {
      await truffleAssert.reverts(module.unlock(wallet.address, { from: guardian }), "BM: wallet must be locked");
    });

    it("should not be able to interact with module which is locked", async () => {
      await module.lock(wallet.address, { from: guardian });

      await truffleAssert.reverts(module.addModule(wallet.address, ZERO_ADDRESS, { from: owner }), "BM: wallet locked");
      await truffleAssert.reverts(module.lock(wallet.address, { from: guardian }), "BM: wallet locked");
      await truffleAssert.reverts(module.addGuardian(wallet.address, ZERO_ADDRESS, { from: owner }), "BM: wallet locked");
      await truffleAssert.reverts(module.confirmGuardianAddition(wallet.address, ZERO_ADDRESS), "BM: wallet locked");
      await truffleAssert.reverts(module.cancelGuardianAddition(wallet.address, ZERO_ADDRESS, { from: owner }), "BM: wallet locked");
      await truffleAssert.reverts(module.cancelGuardianRevokation(wallet.address, ZERO_ADDRESS, { from: owner }), "BM: wallet locked");
      await truffleAssert.reverts(module.addToWhitelist(wallet.address, ZERO_ADDRESS, { from: owner }), "BM: wallet locked");
      await truffleAssert.reverts(module.removeFromWhitelist(wallet.address, ZERO_ADDRESS, { from: owner }), "BM: wallet locked");
    });

    it("should not be able to call functions which are only relayed", async () => {
      await truffleAssert.reverts(module.executeRecovery(wallet.address, ZERO_ADDRESS), "BM: must be module");
      await truffleAssert.reverts(module.cancelRecovery(wallet.address), "BM: must be module");
      await truffleAssert.reverts(module.transferOwnership(wallet.address, ZERO_ADDRESS), "BM: must be module");
      await truffleAssert.reverts(module.multiCall(wallet.address, []), "BM: must be module");
      await truffleAssert.reverts(module.multiCallWithSession(wallet.address, []), "BM: must be module");
      await truffleAssert.reverts(module.multiCallWithGuardians(wallet.address, []), "BM: must be module");
      await truffleAssert.reverts(module.multiCallWithGuardiansAndStartSession(wallet.address, [], ZERO_ADDRESS, 0), "BM: must be module");
      await truffleAssert.reverts(module.clearSession(wallet.address), "BM: must be module");
    });
  });

  describe("Recover tokens", async () => {
    it("should be able to recover ERC20 tokens sent to the module", async () => {
      let balance = await token.balanceOf(module.address);
      assert.equal(balance, 0);

      await token.transfer(module.address, 10000000, { from: owner });
      balance = await token.balanceOf(module.address);
      assert.equal(balance, 10000000);

      await module.recoverToken(token.address);

      balance = await token.balanceOf(module.address);
      assert.equal(balance, 0);

      const registryBalance = await token.balanceOf(registry.address);
      assert.equal(registryBalance, 10000000);

      await registry.recoverToken(token.address);

      const adminBalance = await token.balanceOf(accounts[0]);
      assert.equal(adminBalance, 10000000);
    });

    it.skip("should be able to recover non-ERC20 compliant tokens sent to the module", async () => {
      const nonCompliantToken = await NonCompliantERC20.new();
      await nonCompliantToken.mint(module.address, 10000000);
      let balance = await nonCompliantToken.balanceOf(module.address);
      assert.equal(balance, 10000000);

      await module.recoverToken(nonCompliantToken.address);

      balance = await nonCompliantToken.balanceOf(module.address);
      assert.equal(balance, 0);

      const registryBalance = await nonCompliantToken.balanceOf(registry.address);
      assert.equal(registryBalance, 10000000);

      await registry.recoverToken(nonCompliantToken.address);

      const adminBalance = await nonCompliantToken.balanceOf(accounts[0]);
      assert.equal(adminBalance, 10000000);
    });
  });
});
