/* global artifacts */
const ethers = require("ethers");
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

const TestManager = require("../utils/test-manager");

contract("LockManager", (accounts) => {
  const manager = new TestManager();

  const owner = accounts[1];
  const guardian1 = accounts[2];
  const nonguardian = accounts[3];

  let deployer;
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
    deployer = manager.newDeployer();
    walletImplementation = await deployer.deploy(BaseWallet);
  });

  beforeEach(async () => {
    const registry = await deployer.deploy(Registry);
    guardianStorage = await deployer.deploy(GuardianStorage);
    lockStorage = await deployer.deploy(LockStorage);
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

    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);

    await versionManager.addVersion([
      guardianManager.contractAddress,
      lockManager.contractAddress,
      recoveryManager.contractAddress,
      relayerManager.contractAddress,
    ], []);

    await wallet.init(owner, [versionManager.contractAddress]);
    await versionManager.from(owner).upgradeWallet(wallet.contractAddress, await versionManager.lastVersion());
  });

  describe("(Un)Lock by EOA guardians", () => {
    beforeEach(async () => {
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1);
      const count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
      assert.equal(count, 1, "1 guardian should be added");
      const isGuardian = await guardianManager.isGuardian(wallet.contractAddress, guardian1);
      assert.isTrue(isGuardian, "guardian1 should be a guardian of the wallet");
      const isLocked = await lockManager.isLocked(wallet.contractAddress);
      assert.isFalse(isLocked, "should be unlocked by default");
    });

    it("should be locked/unlocked by EOA guardians (blockchain transaction)", async () => {
      // lock
      await lockManager.from(guardian1).lock(wallet.contractAddress);
      let state = await lockManager.isLocked(wallet.contractAddress);
      assert.isTrue(state, "should be locked by guardian");
      let releaseTime = await lockManager.getLock(wallet.contractAddress);
      assert.isTrue(releaseTime > 0, "releaseTime should be positive");
      const guardianStorageLock = await guardianStorage.getLock(wallet.contractAddress);
      const guardianStorageLocker = await guardianStorage.getLocker(wallet.contractAddress);
      assert.isTrue(guardianStorageLock.eq(0), "legacy guardianStorage's lock should be unused");
      assert.isTrue(guardianStorageLocker === ethers.constants.AddressZero, "legacy guardianStorage's locker should be unused");
      // unlock
      await lockManager.from(guardian1).unlock(wallet.contractAddress);
      state = await lockManager.isLocked(wallet.contractAddress);
      assert.isFalse(state, "should be unlocked by guardian");
      releaseTime = await lockManager.getLock(wallet.contractAddress);
      assert.equal(releaseTime, 0, "releaseTime should be zero");
    });

    it("should be locked/unlocked by EOA guardians (relayed transaction)", async () => {
      await manager.relay(lockManager, "lock", [wallet.contractAddress], wallet, [guardian1]);
      let state = await lockManager.isLocked(wallet.contractAddress);
      assert.isTrue(state, "should be locked by guardian");

      await manager.relay(lockManager, "unlock", [wallet.contractAddress], wallet, [guardian1]);
      state = await lockManager.isLocked(wallet.contractAddress);
      assert.isFalse(state, "should be unlocked by guardian");
    });

    it("should fail to lock/unlock by non-guardian EOAs (blockchain transaction)", async () => {
      await assert.revert(lockManager.from(nonguardian).lock(wallet.contractAddress), "locking from non-guardian should fail");

      await lockManager.from(guardian1).lock(wallet.contractAddress);
      const state = await lockManager.isLocked(wallet.contractAddress);
      assert.isTrue(state, "should be locked by guardian1");

      await assert.revert(lockManager.from(nonguardian).unlock(wallet.contractAddress));
    });
  });

  describe("(Un)Lock by Smart Contract guardians", () => {
    beforeEach(async () => {
      const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
      const guardianWallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);

      await guardianWallet.init(guardian1, [versionManager.contractAddress]);
      await versionManager.from(guardian1).upgradeWallet(guardianWallet.contractAddress, await versionManager.lastVersion());
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardianWallet.contractAddress);
      const count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
      assert.equal(count, 1, "1 guardian should be added");
      const isGuardian = await guardianManager.isGuardian(wallet.contractAddress, guardianWallet.contractAddress);
      assert.isTrue(isGuardian, "guardian1 should be a guardian of the wallet");
      const isLocked = await lockManager.isLocked(wallet.contractAddress);
      assert.isFalse(isLocked, "should be unlocked by default");
    });

    it("should be locked/unlocked by Smart Contract guardians (relayed transaction)", async () => {
      await manager.relay(lockManager, "lock", [wallet.contractAddress], wallet, [guardian1]);
      let state = await lockManager.isLocked(wallet.contractAddress);
      assert.isTrue(state, "should be locked by guardian");

      await manager.relay(lockManager, "unlock", [wallet.contractAddress], wallet, [guardian1]);
      state = await lockManager.isLocked(wallet.contractAddress);
      assert.isFalse(state, "should be unlocked by locker");
    });

    it("should fail to lock/unlock by Smart Contract guardians when signer is not authorized (relayed transaction)", async () => {
      await assert.revertWith(manager.relay(lockManager, "lock", [wallet.contractAddress], wallet, [nonguardian]), "RM: Invalid signatures");
    });
  });

  describe("Auto-unlock", () => {
    it("should auto-unlock after lock period", async () => {
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1);
      await lockManager.from(guardian1).lock(wallet.contractAddress);
      let state = await lockManager.isLocked(wallet.contractAddress);
      assert.isTrue(state, "should be locked by guardian");
      let releaseTime = await lockManager.getLock(wallet.contractAddress);
      assert.isTrue(releaseTime > 0, "releaseTime should be positive");

      await manager.increaseTime(24 * 5 + 5);
      state = await lockManager.isLocked(wallet.contractAddress);
      assert.isFalse(state, "should be unlocked by guardian");
      releaseTime = await lockManager.getLock(wallet.contractAddress);
      assert.equal(releaseTime, 0, "releaseTime should be zero");
    });
  });

  describe("Unlocking wallets", () => {
    beforeEach(async () => {
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1);
    });

    it("should not be able to unlock, an already unlocked wallet", async () => {
      // lock
      await lockManager.from(guardian1).lock(wallet.contractAddress);
      // unlock
      await lockManager.from(guardian1).unlock(wallet.contractAddress);
      // try to unlock again
      await assert.revertWith(lockManager.from(guardian1).unlock(wallet.contractAddress),
        "VM Exception while processing transaction: revert LM: wallet must be locked");
    });

    it("should not be able to unlock a wallet, locked by another feature", async () => {
      // lock by putting the wallet in recovery mode
      await manager.relay(recoveryManager, "executeRecovery", [wallet.contractAddress, accounts[5]], wallet, [guardian1]);

      // try to unlock
      await assert.revertWith(lockManager.from(guardian1).unlock(wallet.contractAddress),
        "LM: cannot unlock a wallet that was locked by another feature");
    });
  });
});
