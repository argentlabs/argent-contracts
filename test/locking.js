/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");

const WalletFactory = artifacts.require("WalletFactory");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const DappRegistry = artifacts.require("DappRegistry");
const UniswapV2Router01 = artifacts.require("DummyUniV2Router");

const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const utils = require("../utils/utilities.js");
const RelayManager = require("../utils/relay-manager");

const { expect } = chai;
chai.use(bnChai(BN));

contract("Locking", (accounts) => {
  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian1 = accounts[2];
  const guardian2 = accounts[3];
  const nonguardian = accounts[4];
  const refundAddress = accounts[7];

  const ZERO_ADDRESS = ethers.constants.AddressZero;
  const SECURITY_PERIOD = 24;
  const SECURITY_WINDOW = 12;
  const LOCK_PERIOD = 24 * 5;
  const RECOVERY_PERIOD = 36;

  let manager;
  let module;
  let wallet;
  let factory;
  let guardianStorage;

  before(async () => {
    const registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    const transferStorage = await TransferStorage.new();
    const dappRegistry = await DappRegistry.new(0);
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
    const walletImplementation = await BaseWallet.new();
    factory = await WalletFactory.new(
      walletImplementation.address,
      guardianStorage.address,
      refundAddress);
    await factory.addManager(infrastructure);

    manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);
  });

  beforeEach(async () => {
    // create wallet
    const walletAddress = await utils.createWallet(factory.address, owner, [module.address], guardian1);
    wallet = await BaseWallet.at(walletAddress);
  });

  describe("(Un)Lock by EOA guardians", () => {
    it("should be locked/unlocked by EOA guardians (blockchain transaction)", async () => {
      // lock
      await module.lock(wallet.address, { from: guardian1 });
      let state = await module.isLocked(wallet.address);
      assert.isTrue(state);
      let releaseTime = await module.getLock(wallet.address);
      expect(releaseTime).to.be.gt.BN(0);
      const guardianStorageLock = await guardianStorage.getLock(wallet.address);
      // legacy guardianStorage's lock should be unused
      expect(guardianStorageLock).to.be.zero;
      // unlock
      await module.unlock(wallet.address, { from: guardian1 });
      state = await module.isLocked(wallet.address);
      assert.isFalse(state);
      releaseTime = await module.getLock(wallet.address);
      expect(releaseTime).to.be.zero;
    });

    it("should be locked/unlocked by EOA guardians (relayed transaction)", async () => {
      await manager.relay(module, "lock", [wallet.address], wallet, [guardian1]);
      let state = await module.isLocked(wallet.address);
      assert.isTrue(state);

      await manager.relay(module, "unlock", [wallet.address], wallet, [guardian1]);
      state = await module.isLocked(wallet.address);
      assert.isFalse(state);
    });

    it("should fail to lock/unlock by non-guardian EOAs (blockchain transaction)", async () => {
      await truffleAssert.reverts(module.lock(wallet.address, { from: nonguardian }), "SM: must be guardian/self");

      await module.lock(wallet.address, { from: guardian1 });
      const state = await module.isLocked(wallet.address);
      assert.isTrue(state);

      await truffleAssert.reverts(module.unlock(wallet.address, { from: nonguardian }), "SM: must be guardian/self");
    });
  });

  describe("(Un)Lock by Smart Contract guardians", () => {
    beforeEach(async () => {
      const guardianWalletAddress = await utils.createWallet(factory.address, guardian1, [module.address], guardian2);
      await module.addGuardian(wallet.address, guardianWalletAddress, { from: owner });
    });

    it("should be locked/unlocked by Smart Contract guardians (relayed transaction)", async () => {
      await manager.relay(module, "lock", [wallet.address], wallet, [guardian1]);
      let state = await module.isLocked(wallet.address);
      assert.isTrue(state);

      await manager.relay(module, "unlock", [wallet.address], wallet, [guardian1]);
      state = await module.isLocked(wallet.address);
      assert.isFalse(state);
    });

    it("should fail to lock/unlock by Smart Contract guardians when signer is not authorized (relayed transaction)", async () => {
      await truffleAssert.reverts(manager.relay(module, "lock", [wallet.address], wallet, [nonguardian]), "RM: Invalid signatures");
    });
  });

  describe("Auto-unlock", () => {
    it("should auto-unlock after lock period", async () => {
      await module.lock(wallet.address, { from: guardian1 });

      await utils.increaseTime(125); // 24 * 5 + 5
      const state = await module.isLocked(wallet.address);
      assert.isFalse(state);
      const releaseTime = await module.getLock(wallet.address);
      expect(releaseTime).to.be.zero;
    });
  });

  describe("Unlocking wallets", () => {
    it("should not be able to unlock, an already unlocked wallet", async () => {
      // lock
      await module.lock(wallet.address, { from: guardian1 });
      // unlock
      await module.unlock(wallet.address, { from: guardian1 });
      // try to unlock again
      await truffleAssert.reverts(module.unlock(wallet.address, { from: guardian1 }),
        "BM: wallet must be locked");
    });

    it("should not be able to unlock a wallet, locked by another feature", async () => {
      // lock by putting the wallet in recovery mode
      await manager.relay(module, "executeRecovery", [wallet.address, accounts[5]], wallet, [guardian1]);

      // try to unlock
      await truffleAssert.reverts(module.unlock(wallet.address, { from: guardian1 }),
        "SM: cannot unlock");
    });
  });
});
