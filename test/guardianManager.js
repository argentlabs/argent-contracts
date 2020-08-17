/* global artifacts */
const ethers = require("ethers");

const GuardianManager = artifacts.require("GuardianManager");
const LockStorage = artifacts.require("LockStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const RelayerManager = artifacts.require("RelayerManager");
const VersionManager = artifacts.require("VersionManager");
const Registry = artifacts.require("ModuleRegistry");
const DumbContract = artifacts.require("TestContract");
const NonCompliantGuardian = artifacts.require("NonCompliantGuardian");

const RelayManager = require("../utils/relay-manager");
const { increaseTime } = require("../utils/utilities.js");

contract("GuardianManager", (accounts) => {
  const manager = new RelayManager();

  const owner = accounts[1];
  const guardian1 = accounts[2];
  const guardian2 = accounts[3];
  const guardian3 = accounts[4];
  const guardian4 = accounts[5];
  const guardian5 = accounts[6];
  const nonowner = accounts[7];

  let wallet;
  let walletImplementation;
  let lockStorage;
  let guardianStorage;
  let guardianManager;
  let relayerManager;
  let versionManager;

  before(async () => {
    walletImplementation = await BaseWallet.new();
  });

  beforeEach(async () => {
    const registry = await deployer.deploy(Registry);
    lockStorage = await deployer.deploy(LockStorage);
    guardianStorage = await deployer.deploy(GuardianStorage);
    versionManager = await deployer.deploy(VersionManager, {},
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    relayerManager = await deployer.deploy(RelayerManager, {},
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.address);
    guardianManager = await deployer.deploy(GuardianManager, {},
      lockStorage.address,
      guardianStorage.address,
      versionManager.address,
      24,
      12);
    await versionManager.addVersion([guardianManager.address, relayerManager.address], []);
    manager.setRelayerManager(relayerManager);

    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.address);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.address);
    await wallet.init(owner, [versionManager.address]);
    await versionManager.from(owner).upgradeWallet(wallet.address, await versionManager.lastVersion());
  });

  describe("Adding Guardians", () => {
    describe("EOA Guardians", () => {
      it("should let the owner add EOA Guardians (blockchain transaction)", async () => {
        await guardianManager.from(owner).addGuardian(wallet.address, guardian1);
        let count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        let active = await guardianManager.isGuardian(wallet.address, guardian1);
        assert.isTrue(active, "first guardian should be active");
        assert.equal(count, 1, "1 guardian should be active");

        await guardianManager.from(owner).addGuardian(wallet.address, guardian2);
        count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        active = await guardianManager.isGuardian(wallet.address, guardian2);
        assert.isFalse(active, "second guardian should not yet be active");
        assert.equal(count, 1, "second guardian should be pending during security period");

        await increaseTime(30);
        await guardianManager.confirmGuardianAddition(wallet.address, guardian2);
        count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        active = await guardianManager.isGuardian(wallet.address, guardian2);
        const guardians = await guardianManager.getGuardians(wallet.address);
        assert.isTrue(active, "second guardian should be active");
        assert.equal(count, 2, "2 guardians should be active after security period");
        assert.equal(guardian1, guardians[0], "should return first guardian address");
        assert.equal(guardian2, guardians[1], "should return second guardian address");
      });

      it("should not let the owner add EOA Guardians after two security periods (blockchain transaction)", async () => {
        await guardianManager.from(owner).addGuardian(wallet.address, guardian1);
        await guardianManager.from(owner).addGuardian(wallet.address, guardian2);

        await increaseTime(48); // 42 == 2 * security_period
        await assert.revertWith(guardianManager.confirmGuardianAddition(wallet.address, guardian2),
          "GM: Too late to confirm guardian addition");

        const count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        const active = await guardianManager.isGuardian(wallet.address, guardian2);
        assert.isFalse(active, "second guardian should not be active (addition confirmation was too late)");
        assert.equal(count, 1, "1 guardian should be active after two security periods (addition confirmation was too late)");
      });

      it("should not allow confirming too early", async () => {
        await guardianManager.from(owner).addGuardian(wallet.address, guardian1);
        await guardianManager.from(owner).addGuardian(wallet.address, guardian2);
        await assert.revertWith(guardianManager.confirmGuardianAddition(wallet.address, guardian2),
          "GM: Too early to confirm guardian addition");
      });

      it("should let the owner re-add EOA Guardians after missing the confirmation window (blockchain transaction)", async () => {
        await guardianManager.from(owner).addGuardian(wallet.address, guardian1);

        // first time
        await guardianManager.from(owner).addGuardian(wallet.address, guardian2);

        await increaseTime(48); // 42 == 2 * security_period
        await assert.revertWith(guardianManager.confirmGuardianAddition(wallet.address, guardian2),
          "GM: Too late to confirm guardian addition");

        // second time
        await guardianManager.from(owner).addGuardian(wallet.address, guardian2);
        let count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        let active = await guardianManager.isGuardian(wallet.address, guardian2);
        assert.isFalse(active, "second guardian should not yet be active");
        assert.equal(count, 1, "second guardian should be pending during security period");

        await increaseTime(30);
        await guardianManager.confirmGuardianAddition(wallet.address, guardian2);
        count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        active = await guardianManager.isGuardian(wallet.address, guardian2);
        assert.isTrue(active, "second guardian should be active");
        assert.equal(count, 2, "2 guardians should be active after security period");
      });

      it("should only let the owner add an EOA guardian", async () => {
        await assert.revertWith(guardianManager.from(nonowner).addGuardian(wallet.address, guardian1),
          "BF: must be owner or feature");
      });

      it("should not allow adding wallet owner as guardian", async () => {
        await assert.revertWith(guardianManager.from(owner).addGuardian(wallet.address, owner),
          "GM: target guardian cannot be owner");
      });

      it("should not allow adding an existing guardian twice", async () => {
        await guardianManager.from(owner).addGuardian(wallet.address, guardian1);
        await assert.revertWith(guardianManager.from(owner).addGuardian(wallet.address, guardian1),
          "GM: target is already a guardian");
      });

      it("should not allow adding a duplicate request to add a guardian to the request queue", async () => {
        await guardianManager.from(owner).addGuardian(wallet.address, guardian1);
        await guardianManager.from(owner).addGuardian(wallet.address, guardian2);
        await assert.revertWith(guardianManager.from(owner).addGuardian(wallet.address, guardian2),
          "GM: addition of target as guardian is already pending");
      });

      it("should let the owner add an EOA guardian (relayed transaction)", async () => {
        await manager.relay(guardianManager, "addGuardian", [wallet.address, guardian1], wallet, [owner]);
        const count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        const active = await guardianManager.isGuardian(wallet.address, guardian1);
        assert.isTrue(active, "first guardian should be active");
        assert.equal(count, 1, "1 guardian should be active");
      });

      it("should add many Guardians (blockchain transaction)", async () => {
        const guardians = [guardian1, guardian2, guardian3, guardian4, guardian5];
        let count;
        let active;
        for (let i = 1; i <= 5; i += 1) {
          await guardianManager.from(owner).addGuardian(wallet.address, guardians[i - 1]);
          if (i > 1) {
            await increaseTime(31);
            await guardianManager.confirmGuardianAddition(wallet.address, guardians[i - 1]);
          }
          count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
          active = await guardianManager.isGuardian(wallet.address, guardians[i - 1]);
          assert.equal(count, i, `guardian ${i} should be added`);
          assert.isTrue(active, `guardian ${i} should be active`);
        }
      });

      it("should add many Guardians (relayed transaction)", async () => {
        const guardians = [guardian1, guardian2, guardian3, guardian4, guardian5];
        let count;
        let active;
        for (let i = 1; i <= 3; i += 1) {
          await manager.relay(guardianManager, "addGuardian", [wallet.address, guardians[i - 1]], wallet, [owner]);
          if (i > 1) {
            await increaseTime(30);
            await manager.relay(guardianManager, "confirmGuardianAddition", [wallet.address, guardians[i - 1]], wallet, []);
          }
          count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
          active = await guardianManager.isGuardian(wallet.address, guardians[i - 1]);
          assert.equal(count, i, `guardian ${i} should be added`);
          assert.isTrue(active, `guardian ${i} should be active`);
        }
      });
    });

    describe("Smart Contract Guardians", () => {
      let guardianWallet1;
      let guardianWallet2;
      let dumbContract;

      beforeEach(async () => {
        const proxy1 = await deployer.deploy(Proxy, {}, walletImplementation.address);
        guardianWallet1 = deployer.wrapDeployedContract(BaseWallet, proxy1.address);
        await guardianWallet1.init(guardian1, [versionManager.address]);

        const proxy2 = await deployer.deploy(Proxy, {}, walletImplementation.address);
        guardianWallet2 = deployer.wrapDeployedContract(BaseWallet, proxy2.address);
        await guardianWallet2.init(guardian2, [versionManager.address]);
        dumbContract = await deployer.deploy(DumbContract);
      });

      it("should let the owner add Smart Contract Guardians (blockchain transaction)", async () => {
        await guardianManager.from(owner).addGuardian(wallet.address, guardianWallet1.address);
        let count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        let active = await guardianManager.isGuardianOrGuardianSigner(wallet.address, guardian1);
        assert.isTrue(active, "first guardian owner should be recognized as guardian");
        active = await guardianManager.isGuardian(wallet.address, guardianWallet1.address);
        assert.isTrue(active, "first guardian should be recognized as guardian");
        assert.equal(count, 1, "1 guardian should be active");

        await guardianManager.from(owner).addGuardian(wallet.address, guardianWallet2.address);
        count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        active = await guardianManager.isGuardian(wallet.address, guardian2);
        assert.isFalse(active, "second guardian owner should not yet be active");
        active = await guardianManager.isGuardian(wallet.address, guardianWallet2.address);
        assert.isFalse(active, "second guardian should not yet be active");
        assert.equal(count, 1, "second guardian should be pending during security period");

        await increaseTime(30);
        await guardianManager.confirmGuardianAddition(wallet.address, guardianWallet2.address);
        count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        active = await guardianManager.isGuardian(wallet.address, guardian2);
        assert.isTrue(active, "second guardian owner should be active");
        active = await guardianManager.isGuardian(wallet.address, guardianWallet2.address);
        assert.isTrue(active, "second guardian should be active");
        assert.equal(count, 2, "2 guardians should be active after security period");
      });

      it("should let the owner add a Smart Contract guardian (relayed transaction)", async () => {
        await manager.relay(guardianManager, "addGuardian", [wallet.address, guardianWallet1.address], wallet, [owner]);
        const count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        let active = await guardianManager.isGuardian(wallet.address, guardianWallet1.address);
        assert.isTrue(active, "first guardian should be active");
        active = await guardianManager.isGuardianOrGuardianSigner(wallet.address, guardian1);
        assert.isTrue(active, "first guardian owner should be active");
        assert.equal(count, 1, "1 guardian should be active");
      });

      it("should not let owner add a Smart Contract guardian that does not have an owner manager", async () => {
        await assert.revertWith(guardianManager.from(owner).addGuardian(wallet.address, dumbContract.address),
          "GM: guardian must be EOA or implement owner()");
      });

      describe("Non-Compliant Guardians", () => {
        let nonCompliantGuardian;
        beforeEach(async () => {
          await guardianManager.from(owner).addGuardian(wallet.address, guardian1);
          nonCompliantGuardian = await NonCompliantGuardian.new();
        });
        it("it should fail to add a non-compliant guardian", async () => {
          await assert.revert(guardianManager.from(owner).addGuardian(wallet.address, nonCompliantGuardian.address));
        });
      });
    });
  });

  describe("Revoking Guardians", () => {
    beforeEach(async () => {
      await guardianManager.from(owner).addGuardian(wallet.address, guardian1);
      await guardianManager.from(owner).addGuardian(wallet.address, guardian2);
      await increaseTime(30);
      await guardianManager.confirmGuardianAddition(wallet.address, guardian2);
      const count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      assert.equal(count, 2, "2 guardians should be added");
    });

    it("should revoke a guardian (blockchain transaction)", async () => {
      await guardianManager.from(owner).revokeGuardian(wallet.address, guardian1);
      let count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      let active = await guardianManager.isGuardian(wallet.address, guardian1);
      assert.isTrue(active, "the revoked guardian should still be active during the security period");
      assert.equal(count, 2, "the revoked guardian should go through a security period");

      await increaseTime(30);
      await guardianManager.confirmGuardianRevokation(wallet.address, guardian1);
      count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      active = await guardianManager.isGuardian(wallet.address, guardian1);
      assert.isFalse(active, "the revoked guardian should no longer be active after the security period");
      assert.equal(count, 1, "the revoked guardian should be removed after the security period");
    });

    it("should not be able to revoke a nonexistent guardian", async () => {
      await assert.revertWith(guardianManager.from(owner).revokeGuardian(wallet.address, nonowner),
        "GM: must be an existing guardian");
    });

    it("should not confirm a guardian revokation too early", async () => {
      await guardianManager.from(owner).revokeGuardian(wallet.address, guardian1);
      await assert.revertWith(guardianManager.confirmGuardianRevokation(wallet.address, guardian1),
        "GM: Too early to confirm guardian revokation");
    });

    it("should not confirm a guardian revokation after two security periods (blockchain transaction)", async () => {
      await guardianManager.from(owner).revokeGuardian(wallet.address, guardian1);

      await increaseTime(48); // 48 == 2 * security_period
      await assert.revertWith(guardianManager.confirmGuardianRevokation(wallet.address, guardian1),
        "GM: Too late to confirm guardian revokation");
    });

    it("should not be able to revoke a guardian twice", async () => {
      await guardianManager.from(owner).revokeGuardian(wallet.address, guardian1);
      await assert.revertWith(guardianManager.from(owner).revokeGuardian(wallet.address, guardian1),
        "GM: revokation of target as guardian is already pending");
    });

    it("should revoke a guardian again after missing the confirmation window the first time (blockchain transaction)", async () => {
      // first time
      await guardianManager.from(owner).revokeGuardian(wallet.address, guardian1);

      await increaseTime(48); // 48 == 2 * security_period
      await assert.revertWith(guardianManager.confirmGuardianRevokation(wallet.address, guardian1),
        "GM: Too late to confirm guardian revokation");

      // second time
      await guardianManager.from(owner).revokeGuardian(wallet.address, guardian1);
      let count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      let active = await guardianManager.isGuardian(wallet.address, guardian1);
      assert.isTrue(active, "the revoked guardian should still be active during the security period");
      assert.equal(count, 2, "the revoked guardian should go through a security period");

      await increaseTime(30);
      await guardianManager.confirmGuardianRevokation(wallet.address, guardian1);
      count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      active = await guardianManager.isGuardian(wallet.address, guardian1);
      assert.isFalse(active, "the revoked guardian should no longer be active after the security period");
      assert.equal(count, 1, "the revoked guardian should be removed after the security period");
    });

    it("should add a guardian after a revoke (blockchain transaction)", async () => {
      await guardianManager.from(owner).revokeGuardian(wallet.address, guardian1);
      await increaseTime(30);
      await guardianManager.confirmGuardianRevokation(wallet.address, guardian1);
      let count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      assert.equal(count, 1, "there should be 1 guardian left");

      await guardianManager.from(owner).addGuardian(wallet.address, guardian3);
      await increaseTime(30);
      await guardianManager.confirmGuardianAddition(wallet.address, guardian3);
      count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      assert.equal(count, 2, "there should be 2 guardians again");
    });

    it("should be able to remove a guardian that is the last in the list", async () => {
      await guardianManager.from(owner).addGuardian(wallet.address, guardian3);
      await increaseTime(30);
      await guardianManager.confirmGuardianAddition(wallet.address, guardian3);
      let count = await guardianStorage.guardianCount(wallet.address);
      assert.equal(count.toNumber(), 3, "there should be 3 guardians");

      const guardians = await guardianStorage.getGuardians(wallet.address);
      await guardianManager.from(owner).revokeGuardian(wallet.address, guardians[2]);
      await increaseTime(30);
      await guardianManager.confirmGuardianRevokation(wallet.address, guardians[2]);
      count = await guardianStorage.guardianCount(wallet.address);
      assert.equal(count.toNumber(), 2, "there should be 2 guardians left");
    });
  });

  describe("Cancelling Pending Guardians", () => {
    beforeEach(async () => {
      await guardianManager.from(owner).addGuardian(wallet.address, guardian1);
      const count = (await guardianManager.guardianCount(wallet.address)).toNumber();
      assert.equal(count, 1, "1 guardian should be added");
    });

    it("owner should be able to cancel pending addition of guardian (blockchain transaction)", async () => {
      // Add guardian 2 and cancel its addition
      await guardianManager.from(owner).addGuardian(wallet.address, guardian2);
      await guardianManager.from(owner).cancelGuardianAddition(wallet.address, guardian2);
      await increaseTime(30);
      await assert.revertWith(guardianManager.confirmGuardianAddition(wallet.address, guardian2),
        "GM: no pending addition as guardian for target");
    });

    it("owner should not be able to cancel a nonexistent addition of a guardian request", async () => {
      await assert.revertWith(guardianManager.from(owner).cancelGuardianAddition(wallet.address, guardian2),
        "GM: no pending addition as guardian for target");
    });

    it("owner should be able to cancel pending revokation of guardian (blockchain transaction)", async () => {
      // Revoke guardian 1 and cancel its revokation
      await guardianManager.from(owner).revokeGuardian(wallet.address, guardian1);
      await guardianManager.from(owner).cancelGuardianRevokation(wallet.address, guardian1);
      await increaseTime(30);
      await assert.revertWith(guardianManager.confirmGuardianRevokation(wallet.address, guardian1),
        "GM: no pending guardian revokation for target");
    });

    it("owner should not be able to cancel a nonexistent pending revokation of guardian", async () => {
      await assert.revertWith(guardianManager.from(owner).cancelGuardianRevokation(wallet.address, nonowner),
        "GM: no pending guardian revokation for target");
    });

    it("owner should be able to cancel pending addition of guardian (relayed transaction)", async () => {
      // Add guardian 2 and cancel its addition
      await manager.relay(guardianManager, "addGuardian", [wallet.address, guardian2], wallet, [owner]);
      await manager.relay(guardianManager, "cancelGuardianAddition", [wallet.address, guardian2], wallet, [owner]);
      await increaseTime(30);
      await assert.revertWith(guardianManager.confirmGuardianAddition(wallet.address, guardian2),
        "GM: no pending addition as guardian for target");
    });

    it("owner should be able to cancel pending revokation of guardian (relayed transaction)", async () => {
      // Revoke guardian 1 and cancel its revokation
      await manager.relay(guardianManager, "revokeGuardian", [wallet.address, guardian1], wallet, [owner]);
      await manager.relay(guardianManager, "cancelGuardianRevokation", [wallet.address, guardian1], wallet, [owner]);
      await increaseTime(30);
      await assert.revertWith(guardianManager.confirmGuardianRevokation(wallet.address, guardian1),
        "GM: no pending guardian revokation for target");
    });
  });

  describe("Guardian Storage", () => {
    it("should not allow non modules to addGuardian", async () => {
      await assert.revertWith(guardianStorage.addGuardian(wallet.address, guardian4),
        "must be an authorized module to call this method");
    });

    it("should not allow non modules to revokeGuardian", async () => {
      await assert.revertWith(guardianStorage.revokeGuardian(wallet.address, guardian1),
        "must be an authorized module to call this method");
    });
  });
});
