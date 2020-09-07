/* global accounts */
const ethers = require("ethers");
const RelayerManager = require("../build/RelayerManager");
const GuardianManager = require("../build/GuardianManager");
const LockManager = require("../build/LockManager");
const LockStorage = require("../build/LockStorage");
const GuardianStorage = require("../build/GuardianStorage");
const Proxy = require("../build/Proxy");
const BaseWallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");
const RecoveryManager = require("../build/RecoveryManager");
const VersionManager = require("../build/VersionManager");

const TestManager = require("../utils/test-manager");

describe("LockManager", function () {
  this.timeout(100000);

  const manager = new TestManager();

  const owner = accounts[1].signer;
  const guardian1 = accounts[2].signer;
  const nonguardian = accounts[3].signer;

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

    await wallet.init(owner.address, [versionManager.contractAddress]);
  });

  describe("(Un)Lock by EOA guardians", () => {
    beforeEach(async () => {
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address);
      const count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
      assert.equal(count, 1, "1 guardian should be added");
      const isGuardian = await guardianManager.isGuardian(wallet.contractAddress, guardian1.address);
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

      await guardianWallet.init(guardian1.address, [versionManager.contractAddress]);
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
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address);
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
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address);
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
      await manager.relay(recoveryManager, "executeRecovery", [wallet.contractAddress, accounts[5].signer.address], wallet, [guardian1]);

      // try to unlock
      await assert.revertWith(lockManager.from(guardian1).unlock(wallet.contractAddress),
        "LM: cannot unlock a wallet that was locked by another feature");
    });
  });
});
