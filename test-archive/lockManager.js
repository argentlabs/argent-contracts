/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");

const RelayerManager = artifacts.require("RelayerManager");
const GuardianManager = artifacts.require("GuardianManager");
const LockManager = artifacts.require("LockManager");
const LockStorage = artifacts.require("LockStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const RecoveryManager = artifacts.require("RecoveryManager");
const VersionManager = artifacts.require("VersionManager");

const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const utilities = require("../utils/utilities.js");
const RelayManager = require("../utils/relay-manager");

const { expect } = chai;
chai.use(bnChai(BN));

contract("LockManager", (accounts) => {
  const manager = new RelayManager();

  const owner = accounts[1];
  const guardian1 = accounts[2];
  const nonguardian = accounts[3];

  let guardianManager;
  let guardianStorage;
  let lockStorage;
  let lockManager;
  let recoveryManager;
  let wallet;
  let walletImplementation;
  let relayerManager;
  let versionManager;

  before(async () => {
    walletImplementation = await BaseWallet.new();
  });

  beforeEach(async () => {
    const registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    lockStorage = await LockStorage.new();
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

    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);

    await versionManager.addVersion([
      guardianManager.address,
      lockManager.address,
      recoveryManager.address,
      relayerManager.address,
    ], []);

    await wallet.init(owner, [versionManager.address]);
    await versionManager.upgradeWallet(wallet.address, await versionManager.lastVersion(), { from: owner });
  });

  describe("(Un)Lock by EOA guardians", () => {
    beforeEach(async () => {
      await guardianManager.addGuardian(wallet.address, guardian1, { from: owner });
      const count = await guardianManager.guardianCount(wallet.address);
      expect(count).to.be.eq.BN(1);
      const isGuardian = await guardianManager.isGuardian(wallet.address, guardian1);
      assert.isTrue(isGuardian);
      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isFalse(isLocked);
    });

    it("should be locked/unlocked by EOA guardians (blockchain transaction)", async () => {
      // lock
      await lockManager.lock(wallet.address, { from: guardian1 });
      let state = await lockManager.isLocked(wallet.address);
      assert.isTrue(state);
      let releaseTime = await lockManager.getLock(wallet.address);
      expect(releaseTime).to.be.gt.BN(0);
      const guardianStorageLock = await guardianStorage.getLock(wallet.address);
      const guardianStorageLocker = await guardianStorage.getLocker(wallet.address);
      // legacy guardianStorage's lock should be unused
      expect(guardianStorageLock).to.be.zero;
      assert.isTrue(guardianStorageLocker === ethers.constants.AddressZero, "legacy guardianStorage's locker should be unused");
      // unlock
      await lockManager.unlock(wallet.address, { from: guardian1 });
      state = await lockManager.isLocked(wallet.address);
      assert.isFalse(state, "should be unlocked by guardian");
      releaseTime = await lockManager.getLock(wallet.address);
      expect(releaseTime).to.be.zero;
    });

    it("should be locked/unlocked by EOA guardians (relayed transaction)", async () => {
      await manager.relay(lockManager, "lock", [wallet.address], wallet, [guardian1]);
      let state = await lockManager.isLocked(wallet.address);
      assert.isTrue(state, "should be locked by guardian");

      await manager.relay(lockManager, "unlock", [wallet.address], wallet, [guardian1]);
      state = await lockManager.isLocked(wallet.address);
      assert.isFalse(state, "should be unlocked by guardian");
    });

    it("should fail to lock/unlock by non-guardian EOAs (blockchain transaction)", async () => {
      await truffleAssert.reverts(lockManager.lock(wallet.address, { from: nonguardian }), "LM: must be guardian or feature");

      await lockManager.lock(wallet.address, { from: guardian1 });
      const state = await lockManager.isLocked(wallet.address);
      assert.isTrue(state, "should be locked by guardian1");

      await truffleAssert.reverts(lockManager.unlock(wallet.address, { from: nonguardian }), "LM: must be guardian or feature");
    });
  });

  describe("(Un)Lock by Smart Contract guardians", () => {
    beforeEach(async () => {
      const proxy = await Proxy.new(walletImplementation.address);
      const guardianWallet = await BaseWallet.at(proxy.address);

      await guardianWallet.init(guardian1, [versionManager.address]);
      await versionManager.upgradeWallet(guardianWallet.address, await versionManager.lastVersion(), { from: guardian1 });
      await guardianManager.addGuardian(wallet.address, guardianWallet.address, { from: owner });
      const count = await guardianManager.guardianCount(wallet.address);
      expect(count).to.be.eq.BN(1);
      const isGuardian = await guardianManager.isGuardian(wallet.address, guardianWallet.address);
      assert.isTrue(isGuardian, "guardian1 should be a guardian of the wallet");
      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isFalse(isLocked, "should be unlocked by default");
    });

    it("should be locked/unlocked by Smart Contract guardians (relayed transaction)", async () => {
      await manager.relay(lockManager, "lock", [wallet.address], wallet, [guardian1]);
      let state = await lockManager.isLocked(wallet.address);
      assert.isTrue(state, "should be locked by guardian");

      await manager.relay(lockManager, "unlock", [wallet.address], wallet, [guardian1]);
      state = await lockManager.isLocked(wallet.address);
      assert.isFalse(state, "should be unlocked by locker");
    });

    it("should fail to lock/unlock by Smart Contract guardians when signer is not authorized (relayed transaction)", async () => {
      await truffleAssert.reverts(manager.relay(lockManager, "lock", [wallet.address], wallet, [nonguardian]), "RM: Invalid signatures");
    });
  });

  describe("Auto-unlock", () => {
    it("should auto-unlock after lock period", async () => {
      await guardianManager.addGuardian(wallet.address, guardian1, { from: owner });
      await lockManager.lock(wallet.address, { from: guardian1 });
      let state = await lockManager.isLocked(wallet.address);
      assert.isTrue(state, "should be locked by guardian");
      let releaseTime = await lockManager.getLock(wallet.address);
      assert.isTrue(releaseTime > 0, "releaseTime should be positive");

      await utilities.increaseTime(125); // 24 * 5 + 5
      state = await lockManager.isLocked(wallet.address);
      assert.isFalse(state, "should be unlocked by guardian");
      releaseTime = await lockManager.getLock(wallet.address);
      expect(releaseTime).to.be.zero;
    });
  });

  describe("Unlocking wallets", () => {
    beforeEach(async () => {
      await guardianManager.addGuardian(wallet.address, guardian1, { from: owner });
    });

    it("should not be able to unlock, an already unlocked wallet", async () => {
      // lock
      await lockManager.lock(wallet.address, { from: guardian1 });
      // unlock
      await lockManager.unlock(wallet.address, { from: guardian1 });
      // try to unlock again
      await truffleAssert.reverts(lockManager.unlock(wallet.address, { from: guardian1 }),
        "LM: wallet must be locked");
    });

    it("should not be able to unlock a wallet, locked by another feature", async () => {
      // lock by putting the wallet in recovery mode
      await manager.relay(recoveryManager, "executeRecovery", [wallet.address, accounts[5]], wallet, [guardian1]);

      // try to unlock
      await truffleAssert.reverts(lockManager.unlock(wallet.address, { from: guardian1 }),
        "LM: cannot unlock a wallet that was locked by another feature");
    });
  });
});
