const GuardianManager = require("../build/GuardianManager");
const LockManager = require("../build/LockManager");
const GuardianStorage = require("../build/GuardianStorage");
const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");

const TestManager = require("../utils/test-manager");
const { parseRelayReceipt } = require("../utils/utilities.js");

describe("LockManager", function () {
    this.timeout(10000);

    const manager = new TestManager();

    let owner = accounts[1].signer;
    let guardian1 = accounts[2].signer;
    let nonguardian = accounts[3].signer;

    let guardianManager, lockManager, wallet;

    beforeEach(async () => {
        deployer = manager.newDeployer();
        const registry = await deployer.deploy(Registry);
        let guardianStorage = await deployer.deploy(GuardianStorage);
        guardianManager = await deployer.deploy(GuardianManager, {}, registry.contractAddress, guardianStorage.contractAddress, 24, 12);
        lockManager = await deployer.deploy(LockManager, {}, registry.contractAddress, guardianStorage.contractAddress, 24 * 5);
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [guardianManager.contractAddress, lockManager.contractAddress]);
    });

    describe("(Un)Lock by EOA guardians", () => {
        beforeEach(async () => {
            await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address, { gasLimit: 500000 });
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
            guardianWallet = await deployer.deploy(Wallet);
            await guardianWallet.init(guardian1.address, [guardianManager.contractAddress, lockManager.contractAddress]);
            await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardianWallet.contractAddress, { gasLimit: 500000 });
            const count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
            assert.equal(count, 1, "1 guardian should be added");
            const isGuardian = await guardianManager.isGuardian(wallet.contractAddress, guardianWallet.contractAddress);
            assert.isTrue(isGuardian, "guardian1 should be a guardian of the wallet");
            let isLocked = await lockManager.isLocked(wallet.contractAddress);
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
            let txReceipt = await manager.relay(lockManager, "lock", [wallet.contractAddress], wallet, [nonguardian]);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "locking from non-guardian should fail");
        });
    });

    describe("Auto-unlock", () => {
        it("should auto-unlock after lock period", async () => {
            await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address, { gasLimit: 500000 });
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
});