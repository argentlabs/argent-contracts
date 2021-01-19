/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");

const IWallet = artifacts.require("IWallet");
const DelegateProxy = artifacts.require("DelegateProxy");

const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const utilities = require("../utils/utilities.js");
const { setupWalletVersion } = require("../utils/wallet_definition.js");
const RelayManager = require("../utils/relay-manager");

const { expect } = chai;
chai.use(bnChai(BN));

contract.skip("LockManager", (accounts) => {
  const manager = new RelayManager();

  const owner = accounts[1];
  const guardian1 = accounts[2];
  const nonguardian = accounts[3];

  let registry;
  let wallet;
  let relayerManager;

  before(async () => {
    const modules = await setupWalletVersion({ });
    registry = modules.registry;
    relayerManager = modules.relayerManager;
    await manager.setRelayerManager(relayerManager);
  });

  beforeEach(async () => {
    const proxy = await DelegateProxy.new({ from: owner });
    await proxy.setRegistry(registry.address, { from: owner });
    wallet = await IWallet.at(proxy.address);
  });

  describe("(Un)Lock by EOA guardians", () => {
    beforeEach(async () => {
      await wallet.addGuardian(guardian1, { from: owner });
      const count = await wallet.guardianCount();
      expect(count).to.be.eq.BN(1);
      const isGuardian = await wallet.isGuardian(guardian1);
      assert.isTrue(isGuardian);
      const isLocked = await wallet.isLocked();
      assert.isFalse(isLocked);
    });

    it("should be locked/unlocked by EOA guardians (blockchain transaction)", async () => {
      // lock
      await wallet.lock({ from: guardian1 });
      let state = await wallet.isLocked();
      assert.isTrue(state);
      let releaseTime = await wallet.getLock();
      expect(releaseTime).to.be.gt.BN(0);
      const guardianStorageLock = await wallet.getLock();
      const guardianStorageLocker = await guardianStorage.getLocker();
      // legacy guardianStorage's lock should be unused
      expect(guardianStorageLock).to.be.zero;
      assert.isTrue(guardianStorageLocker === ethers.constants.AddressZero, "legacy guardianStorage's locker should be unused");
      // unlock
      await wallet.unlock({ from: guardian1 });
      state = await wallet.isLocked();
      assert.isFalse(state, "should be unlocked by guardian");
      releaseTime = await wallet.getLock();
      expect(releaseTime).to.be.zero;
    });

    it("should be locked/unlocked by EOA guardians (relayed transaction)", async () => {
      await manager.relay(wallet, "lock", [], [guardian1]);
      let state = await wallet.isLocked();
      assert.isTrue(state, "should be locked by guardian");

      await manager.relay(wallet, "unlock", [], [guardian1]);
      state = await wallet.isLocked();
      assert.isFalse(state, "should be unlocked by guardian");
    });

    it("should fail to lock/unlock by non-guardian EOAs (blockchain transaction)", async () => {
      await truffleAssert.reverts(wallet.lock({ from: nonguardian }), "LM: must be guardian or feature");

      await wallet.lock({ from: guardian1 });
      const state = await wallet.isLocked();
      assert.isTrue(state, "should be locked by guardian1");

      await truffleAssert.reverts(wallet.unlock({ from: nonguardian }), "LM: must be guardian or feature");
    });
  });

  describe("(Un)Lock by Smart Contract guardians", () => {
    beforeEach(async () => {
      const proxy = await DelegateProxy.new({ from: guardian1 });
      await proxy.setRegistry(registry.address, { from: guardian1 });
      const guardianWallet = await IWallet.at(proxy.address);

      await wallet.addGuardian(guardianWallet.address, { from: owner });
      const count = await wallet.guardianCount();
      expect(count).to.be.eq.BN(1);
      const isGuardian = await wallet.isGuardian(guardianWallet.address);
      assert.isTrue(isGuardian, "guardian1 should be a guardian of the wallet");
      const isLocked = await wallet.isLocked();
      assert.isFalse(isLocked, "should be unlocked by default");
    });

    it("should be locked/unlocked by Smart Contract guardians (relayed transaction)", async () => {
      await manager.relay(wallet, "lock", [], [guardian1]);
      let state = await wallet.isLocked();
      assert.isTrue(state, "should be locked by guardian");

      await manager.relay(wallet, "unlock", [], [guardian1]);
      state = await wallet.isLocked();
      assert.isFalse(state, "should be unlocked by locker");
    });

    it("should fail to lock/unlock by Smart Contract guardians when signer is not authorized (relayed transaction)", async () => {
      await truffleAssert.reverts(manager.relay(wallet, "lock", [], [nonguardian]), "RM: Invalid signatures");
    });
  });

  describe("Auto-unlock", () => {
    it("should auto-unlock after lock period", async () => {
      await wallet.addGuardian(guardian1, { from: owner });
      await wallet.lock({ from: guardian1 });
      let state = await wallet.isLocked();
      assert.isTrue(state, "should be locked by guardian");
      let releaseTime = await wallet.getLock();
      assert.isTrue(releaseTime > 0, "releaseTime should be positive");

      await utilities.increaseTime(125); // 24 * 5 + 5
      state = await wallet.isLocked();
      assert.isFalse(state, "should be unlocked by guardian");
      releaseTime = await wallet.getLock();
      expect(releaseTime).to.be.zero;
    });
  });

  describe("Unlocking wallets", () => {
    beforeEach(async () => {
      await wallet.addGuardian(guardian1, { from: owner });
    });

    it("should not be able to unlock, an already unlocked wallet", async () => {
      // lock
      await wallet.lock({ from: guardian1 });
      // unlock
      await wallet.unlock({ from: guardian1 });
      // try to unlock again
      await truffleAssert.reverts(wallet.unlock({ from: guardian1 }),
        "LM: wallet must be locked");
    });

    it("should not be able to unlock a wallet, locked by another feature", async () => {
      // lock by putting the wallet in recovery mode
      await manager.relay(wallet, "executeRecovery", [accounts[5]], [guardian1]);

      // try to unlock
      await truffleAssert.reverts(wallet.unlock({ from: guardian1 }),
        "LM: cannot unlock a wallet that was locked by another feature");
    });
  });
});
