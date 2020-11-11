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

const TestManager = require("../utils/test-manager");

contract("GuardianManager", function (accounts) {
  this.timeout(10000);

  const manager = new TestManager(accounts);

  const owner = accounts[1].signer;
  const guardian1 = accounts[2].signer;
  const guardian2 = accounts[3].signer;
  const guardian3 = accounts[4].signer;
  const guardian4 = accounts[5].signer;
  const guardian5 = accounts[6].signer;
  const nonowner = accounts[7].signer;

  let deployer;
  let wallet;
  let walletImplementation;
  let lockStorage;
  let guardianStorage;
  let guardianManager;
  let relayerManager;
  let versionManager;

  before(async () => {
    deployer = manager.newDeployer();
    walletImplementation = await deployer.deploy(BaseWallet);
  });

  beforeEach(async () => {
    const registry = await deployer.deploy(Registry);
    lockStorage = await deployer.deploy(LockStorage);
    guardianStorage = await deployer.deploy(GuardianStorage);
    versionManager = await deployer.deploy(VersionManager, {},
      registry.contractAddress,
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    relayerManager = await deployer.deploy(RelayerManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      versionManager.contractAddress);
    guardianManager = await deployer.deploy(GuardianManager, {},
      lockStorage.contractAddress,
      guardianStorage.contractAddress,
      versionManager.contractAddress,
      24,
      12);
    await versionManager.addVersion([guardianManager.contractAddress, relayerManager.contractAddress], []);
    manager.setRelayerManager(relayerManager);

    const proxy = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
    wallet = deployer.wrapDeployedContract(BaseWallet, proxy.contractAddress);
    await wallet.init(owner.address, [versionManager.contractAddress]);
    await versionManager.from(owner).upgradeWallet(wallet.contractAddress, await versionManager.lastVersion());
  });

  describe("Adding Guardians", () => {
    describe("EOA Guardians", () => {
      it("should let the owner add EOA Guardians (blockchain transaction)", async () => {
        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address);
        let count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
        let active = await guardianManager.isGuardian(wallet.contractAddress, guardian1.address);
        assert.isTrue(active, "first guardian should be active");
        assert.equal(count, 1, "1 guardian should be active");

        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian2.address);
        count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
        active = await guardianManager.isGuardian(wallet.contractAddress, guardian2.address);
        assert.isFalse(active, "second guardian should not yet be active");
        assert.equal(count, 1, "second guardian should be pending during security period");

        await manager.increaseTime(30);
        await guardianManager.confirmGuardianAddition(wallet.contractAddress, guardian2.address);
        count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
        active = await guardianManager.isGuardian(wallet.contractAddress, guardian2.address);
        const guardians = await guardianManager.getGuardians(wallet.contractAddress);
        assert.isTrue(active, "second guardian should be active");
        assert.equal(count, 2, "2 guardians should be active after security period");
        assert.equal(guardian1.address, guardians[0], "should return first guardian address");
        assert.equal(guardian2.address, guardians[1], "should return second guardian address");
      });

      it("should not let the owner add EOA Guardians after two security periods (blockchain transaction)", async () => {
        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address);
        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian2.address);

        await manager.increaseTime(48); // 42 == 2 * security_period
        await assert.revertWith(guardianManager.confirmGuardianAddition(wallet.contractAddress, guardian2.address),
          "GM: Too late to confirm guardian addition");

        const count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
        const active = await guardianManager.isGuardian(wallet.contractAddress, guardian2.address);
        assert.isFalse(active, "second guardian should not be active (addition confirmation was too late)");
        assert.equal(count, 1, "1 guardian should be active after two security periods (addition confirmation was too late)");
      });

      it("should not allow confirming too early", async () => {
        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address);
        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian2.address);
        await assert.revertWith(guardianManager.confirmGuardianAddition(wallet.contractAddress, guardian2.address),
          "GM: Too early to confirm guardian addition");
      });

      it("should let the owner re-add EOA Guardians after missing the confirmation window (blockchain transaction)", async () => {
        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address);

        // first time
        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian2.address);

        await manager.increaseTime(48); // 42 == 2 * security_period
        await assert.revertWith(guardianManager.confirmGuardianAddition(wallet.contractAddress, guardian2.address),
          "GM: Too late to confirm guardian addition");

        // second time
        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian2.address);
        let count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
        let active = await guardianManager.isGuardian(wallet.contractAddress, guardian2.address);
        assert.isFalse(active, "second guardian should not yet be active");
        assert.equal(count, 1, "second guardian should be pending during security period");

        await manager.increaseTime(30);
        await guardianManager.confirmGuardianAddition(wallet.contractAddress, guardian2.address);
        count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
        active = await guardianManager.isGuardian(wallet.contractAddress, guardian2.address);
        assert.isTrue(active, "second guardian should be active");
        assert.equal(count, 2, "2 guardians should be active after security period");
      });

      it("should only let the owner add an EOA guardian", async () => {
        await assert.revertWith(guardianManager.from(nonowner).addGuardian(wallet.contractAddress, guardian1.address),
          "BF: must be owner or feature");
      });

      it("should not allow adding wallet owner as guardian", async () => {
        await assert.revertWith(guardianManager.from(owner).addGuardian(wallet.contractAddress, owner.address),
          "GM: target guardian cannot be owner");
      });

      it("should not allow adding an existing guardian twice", async () => {
        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address);
        await assert.revertWith(guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address),
          "GM: target is already a guardian");
      });

      it("should not allow adding a duplicate request to add a guardian to the request queue", async () => {
        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address);
        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian2.address);
        await assert.revertWith(guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian2.address),
          "GM: addition of target as guardian is already pending");
      });

      it("should let the owner add an EOA guardian (relayed transaction)", async () => {
        await manager.relay(guardianManager, "addGuardian", [wallet.contractAddress, guardian1.address], wallet, [owner]);
        const count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
        const active = await guardianManager.isGuardian(wallet.contractAddress, guardian1.address);
        assert.isTrue(active, "first guardian should be active");
        assert.equal(count, 1, "1 guardian should be active");
      });

      it("should add many Guardians (blockchain transaction)", async () => {
        const guardians = [guardian1, guardian2, guardian3, guardian4, guardian5];
        let count;
        let active;
        for (let i = 1; i <= 5; i += 1) {
          await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardians[i - 1].address);
          if (i > 1) {
            await manager.increaseTime(31);
            await guardianManager.confirmGuardianAddition(wallet.contractAddress, guardians[i - 1].address);
          }
          count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
          active = await guardianManager.isGuardian(wallet.contractAddress, guardians[i - 1].address);
          assert.equal(count, i, `guardian ${i} should be added`);
          assert.isTrue(active, `guardian ${i} should be active`);
        }
      });

      it("should add many Guardians (relayed transaction)", async () => {
        const guardians = [guardian1, guardian2, guardian3, guardian4, guardian5];
        let count;
        let active;
        for (let i = 1; i <= 3; i += 1) {
          await manager.relay(guardianManager, "addGuardian", [wallet.contractAddress, guardians[i - 1].address], wallet, [owner]);
          if (i > 1) {
            await manager.increaseTime(30);
            await manager.relay(guardianManager, "confirmGuardianAddition", [wallet.contractAddress, guardians[i - 1].address], wallet, []);
          }
          count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
          active = await guardianManager.isGuardian(wallet.contractAddress, guardians[i - 1].address);
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
        const proxy1 = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
        guardianWallet1 = deployer.wrapDeployedContract(BaseWallet, proxy1.contractAddress);
        await guardianWallet1.init(guardian1.address, [versionManager.contractAddress]);

        const proxy2 = await deployer.deploy(Proxy, {}, walletImplementation.contractAddress);
        guardianWallet2 = deployer.wrapDeployedContract(BaseWallet, proxy2.contractAddress);
        await guardianWallet2.init(guardian2.address, [versionManager.contractAddress]);
        dumbContract = await deployer.deploy(DumbContract);
      });

      it("should let the owner add Smart Contract Guardians (blockchain transaction)", async () => {
        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardianWallet1.contractAddress);
        let count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
        let active = await guardianManager.isGuardianOrGuardianSigner(wallet.contractAddress, guardian1.address);
        assert.isTrue(active, "first guardian owner should be recognized as guardian");
        active = await guardianManager.isGuardian(wallet.contractAddress, guardianWallet1.contractAddress);
        assert.isTrue(active, "first guardian should be recognized as guardian");
        assert.equal(count, 1, "1 guardian should be active");

        await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardianWallet2.contractAddress);
        count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
        active = await guardianManager.isGuardianOrGuardianSigner(wallet.contractAddress, guardian2.address);
        assert.isFalse(active, "second guardian owner should not yet be active");
        active = await guardianManager.isGuardian(wallet.contractAddress, guardianWallet2.contractAddress);
        assert.isFalse(active, "second guardian should not yet be active");
        assert.equal(count, 1, "second guardian should be pending during security period");

        await manager.increaseTime(30);
        await guardianManager.confirmGuardianAddition(wallet.contractAddress, guardianWallet2.contractAddress);
        count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
        active = await guardianManager.isGuardianOrGuardianSigner(wallet.contractAddress, guardian2.address);
        assert.isTrue(active, "second guardian owner should be active");
        active = await guardianManager.isGuardian(wallet.contractAddress, guardianWallet2.contractAddress);
        assert.isTrue(active, "second guardian should be active");
        assert.equal(count, 2, "2 guardians should be active after security period");
      });

      it("should let the owner add a Smart Contract guardian (relayed transaction)", async () => {
        await manager.relay(guardianManager, "addGuardian", [wallet.contractAddress, guardianWallet1.contractAddress], wallet, [owner]);
        const count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
        let active = await guardianManager.isGuardian(wallet.contractAddress, guardianWallet1.contractAddress);
        assert.isTrue(active, "first guardian should be active");
        active = await guardianManager.isGuardianOrGuardianSigner(wallet.contractAddress, guardian1.address);
        assert.isTrue(active, "first guardian owner should be active");
        assert.equal(count, 1, "1 guardian should be active");
      });

      it("should not let owner add a Smart Contract guardian that does not have an owner manager", async () => {
        await assert.revertWith(guardianManager.from(owner).addGuardian(wallet.contractAddress, dumbContract.contractAddress),
          "GM: guardian must be EOA or implement owner()");
      });

      describe("Non-Compliant Guardians", () => {
        let nonCompliantGuardian;
        beforeEach(async () => {
          await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address);
          nonCompliantGuardian = await deployer.deploy(NonCompliantGuardian);
        });
        it("it should fail to add a non-compliant guardian", async () => {
          await assert.revert(guardianManager.from(owner).addGuardian(wallet.contractAddress, nonCompliantGuardian.contractAddress));
        });
      });
    });
  });

  describe("Revoking Guardians", () => {
    beforeEach(async () => {
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address);
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian2.address);
      await manager.increaseTime(30);
      await guardianManager.confirmGuardianAddition(wallet.contractAddress, guardian2.address);
      const count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
      assert.equal(count, 2, "2 guardians should be added");
    });

    it("should revoke a guardian (blockchain transaction)", async () => {
      await guardianManager.from(owner).revokeGuardian(wallet.contractAddress, guardian1.address);
      let count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
      let active = await guardianManager.isGuardian(wallet.contractAddress, guardian1.address);
      assert.isTrue(active, "the revoked guardian should still be active during the security period");
      assert.equal(count, 2, "the revoked guardian should go through a security period");

      await manager.increaseTime(30);
      await guardianManager.confirmGuardianRevokation(wallet.contractAddress, guardian1.address);
      count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
      active = await guardianManager.isGuardian(wallet.contractAddress, guardian1.address);
      assert.isFalse(active, "the revoked guardian should no longer be active after the security period");
      assert.equal(count, 1, "the revoked guardian should be removed after the security period");
    });

    it("should not be able to revoke a nonexistent guardian", async () => {
      await assert.revertWith(guardianManager.from(owner).revokeGuardian(wallet.contractAddress, nonowner.address),
        "GM: must be an existing guardian");
    });

    it("should not confirm a guardian revokation too early", async () => {
      await guardianManager.from(owner).revokeGuardian(wallet.contractAddress, guardian1.address);
      await assert.revertWith(guardianManager.confirmGuardianRevokation(wallet.contractAddress, guardian1.address),
        "GM: Too early to confirm guardian revokation");
    });

    it("should not confirm a guardian revokation after two security periods (blockchain transaction)", async () => {
      await guardianManager.from(owner).revokeGuardian(wallet.contractAddress, guardian1.address);

      await manager.increaseTime(48); // 48 == 2 * security_period
      await assert.revertWith(guardianManager.confirmGuardianRevokation(wallet.contractAddress, guardian1.address),
        "GM: Too late to confirm guardian revokation");
    });

    it("should not be able to revoke a guardian twice", async () => {
      await guardianManager.from(owner).revokeGuardian(wallet.contractAddress, guardian1.address);
      await assert.revertWith(guardianManager.from(owner).revokeGuardian(wallet.contractAddress, guardian1.address),
        "GM: revokation of target as guardian is already pending");
    });

    it("should revoke a guardian again after missing the confirmation window the first time (blockchain transaction)", async () => {
      // first time
      await guardianManager.from(owner).revokeGuardian(wallet.contractAddress, guardian1.address);

      await manager.increaseTime(48); // 48 == 2 * security_period
      await assert.revertWith(guardianManager.confirmGuardianRevokation(wallet.contractAddress, guardian1.address),
        "GM: Too late to confirm guardian revokation");

      // second time
      await guardianManager.from(owner).revokeGuardian(wallet.contractAddress, guardian1.address);
      let count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
      let active = await guardianManager.isGuardian(wallet.contractAddress, guardian1.address);
      assert.isTrue(active, "the revoked guardian should still be active during the security period");
      assert.equal(count, 2, "the revoked guardian should go through a security period");

      await manager.increaseTime(30);
      await guardianManager.confirmGuardianRevokation(wallet.contractAddress, guardian1.address);
      count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
      active = await guardianManager.isGuardian(wallet.contractAddress, guardian1.address);
      assert.isFalse(active, "the revoked guardian should no longer be active after the security period");
      assert.equal(count, 1, "the revoked guardian should be removed after the security period");
    });

    it("should add a guardian after a revoke (blockchain transaction)", async () => {
      await guardianManager.from(owner).revokeGuardian(wallet.contractAddress, guardian1.address);
      await manager.increaseTime(30);
      await guardianManager.confirmGuardianRevokation(wallet.contractAddress, guardian1.address);
      let count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
      assert.equal(count, 1, "there should be 1 guardian left");

      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian3.address);
      await manager.increaseTime(30);
      await guardianManager.confirmGuardianAddition(wallet.contractAddress, guardian3.address);
      count = (await guardianStorage.guardianCount(wallet.contractAddress)).toNumber();
      assert.equal(count, 2, "there should be 2 guardians again");
    });

    it("should be able to remove a guardian that is the last in the list", async () => {
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian3.address);
      await manager.increaseTime(30);
      await guardianManager.confirmGuardianAddition(wallet.contractAddress, guardian3.address);
      let count = await guardianStorage.guardianCount(wallet.contractAddress);
      assert.equal(count.toNumber(), 3, "there should be 3 guardians");

      const guardians = await guardianStorage.getGuardians(wallet.contractAddress);
      await guardianManager.from(owner).revokeGuardian(wallet.contractAddress, guardians[2]);
      await manager.increaseTime(30);
      await guardianManager.confirmGuardianRevokation(wallet.contractAddress, guardians[2]);
      count = await guardianStorage.guardianCount(wallet.contractAddress);
      assert.equal(count.toNumber(), 2, "there should be 2 guardians left");
    });
  });

  describe("Cancelling Pending Guardians", () => {
    beforeEach(async () => {
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian1.address);
      const count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
      assert.equal(count, 1, "1 guardian should be added");
    });

    it("owner should be able to cancel pending addition of guardian (blockchain transaction)", async () => {
      // Add guardian 2 and cancel its addition
      await guardianManager.from(owner).addGuardian(wallet.contractAddress, guardian2.address);
      await guardianManager.from(owner).cancelGuardianAddition(wallet.contractAddress, guardian2.address);
      await manager.increaseTime(30);
      await assert.revertWith(guardianManager.confirmGuardianAddition(wallet.contractAddress, guardian2.address),
        "GM: no pending addition as guardian for target");
    });

    it("owner should not be able to cancel a nonexistent addition of a guardian request", async () => {
      await assert.revertWith(guardianManager.from(owner).cancelGuardianAddition(wallet.contractAddress, guardian2.address),
        "GM: no pending addition as guardian for target");
    });

    it("owner should be able to cancel pending revokation of guardian (blockchain transaction)", async () => {
      // Revoke guardian 1 and cancel its revokation
      await guardianManager.from(owner).revokeGuardian(wallet.contractAddress, guardian1.address);
      await guardianManager.from(owner).cancelGuardianRevokation(wallet.contractAddress, guardian1.address);
      await manager.increaseTime(30);
      await assert.revertWith(guardianManager.confirmGuardianRevokation(wallet.contractAddress, guardian1.address),
        "GM: no pending guardian revokation for target");
    });

    it("owner should not be able to cancel a nonexistent pending revokation of guardian", async () => {
      await assert.revertWith(guardianManager.from(owner).cancelGuardianRevokation(wallet.contractAddress, nonowner.address),
        "GM: no pending guardian revokation for target");
    });

    it("owner should be able to cancel pending addition of guardian (relayed transaction)", async () => {
      // Add guardian 2 and cancel its addition
      await manager.relay(guardianManager, "addGuardian", [wallet.contractAddress, guardian2.address], wallet, [owner]);
      await manager.relay(guardianManager, "cancelGuardianAddition", [wallet.contractAddress, guardian2.address], wallet, [owner]);
      await manager.increaseTime(30);
      await assert.revertWith(guardianManager.confirmGuardianAddition(wallet.contractAddress, guardian2.address),
        "GM: no pending addition as guardian for target");
    });

    it("owner should be able to cancel pending revokation of guardian (relayed transaction)", async () => {
      // Revoke guardian 1 and cancel its revokation
      await manager.relay(guardianManager, "revokeGuardian", [wallet.contractAddress, guardian1.address], wallet, [owner]);
      await manager.relay(guardianManager, "cancelGuardianRevokation", [wallet.contractAddress, guardian1.address], wallet, [owner]);
      await manager.increaseTime(30);
      await assert.revertWith(guardianManager.confirmGuardianRevokation(wallet.contractAddress, guardian1.address),
        "GM: no pending guardian revokation for target");
    });
  });

  describe("Guardian Storage", () => {
    it("should not allow non modules to addGuardian", async () => {
      await assert.revertWith(guardianStorage.addGuardian(wallet.contractAddress, guardian4.address),
        "must be an authorized module to call this method");
    });

    it("should not allow non modules to revokeGuardian", async () => {
      await assert.revertWith(guardianStorage.revokeGuardian(wallet.contractAddress, guardian1.address),
        "must be an authorized module to call this method");
    });
  });
});
