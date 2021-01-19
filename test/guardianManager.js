/* global artifacts */
const truffleAssert = require("truffle-assertions");

const IWallet = artifacts.require("IWallet");
const DelegateProxy = artifacts.require("DelegateProxy");
const DumbContract = artifacts.require("TestContract");
const NonCompliantGuardian = artifacts.require("NonCompliantGuardian");

const RelayManager = require("../utils/relay-manager");
const utilities = require("../utils/utilities.js");
const { setupWalletVersion } = require("../utils/wallet_definition.js");

const SECURITY_WINDOW = 240;

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
  let registry;

  before(async () => {
    const modules = await setupWalletVersion({ });
    registry = modules.registry;
    const relayerManager = modules.relayerManager;
    await manager.setRelayerManager(relayerManager);
  });

  beforeEach(async () => {
    const proxy = await DelegateProxy.new({ from: owner });
    await proxy.setRegistry(registry.address, { from: owner });
    wallet = await IWallet.at(proxy.address);
  });

  describe("Adding Guardians", () => {
    describe("EOA Guardians", () => {
      it("should let the owner add EOA Guardians (blockchain transaction)", async () => {
        await wallet.addGuardian(guardian1, { from: owner });
        let count = (await wallet.guardianCount()).toNumber();
        let active = await wallet.isGuardian(guardian1);
        assert.isTrue(active, "first guardian should be active");
        assert.equal(count, 1, "1 guardian should be active");

        await wallet.addGuardian(guardian2, { from: owner });
        count = (await wallet.guardianCount()).toNumber();
        active = await wallet.isGuardian(guardian2);
        assert.isFalse(active, "second guardian should not yet be active");
        assert.equal(count, 1, "second guardian should be pending during security period");

        await utilities.increaseTime(SECURITY_WINDOW + 1);
        await wallet.confirmGuardianAddition(guardian2);
        count = (await wallet.guardianCount()).toNumber();
        active = await wallet.isGuardian(guardian2);
        const guardians = await wallet.getGuardians();
        assert.isTrue(active, "second guardian should be active");
        assert.equal(count, 2, "2 guardians should be active after security period");
        assert.equal(guardian1, guardians[0], "should return first guardian address");
        assert.equal(guardian2, guardians[1], "should return second guardian address");
      });

      it("should not let the owner add EOA Guardians after two security periods (blockchain transaction)", async () => {
        await wallet.addGuardian(guardian1, { from: owner });
        await wallet.addGuardian(guardian2, { from: owner });

        await utilities.increaseTime(SECURITY_WINDOW * 2);
        await truffleAssert.reverts(wallet.confirmGuardianAddition(guardian2), "GM: Too late to confirm guardian addition");

        const count = (await wallet.guardianCount()).toNumber();
        const active = await wallet.isGuardian(guardian2);
        assert.isFalse(active, "second guardian should not be active (addition confirmation was too late)");
        assert.equal(count, 1, "1 guardian should be active after two security periods (addition confirmation was too late)");
      });

      it("should not allow confirming too early", async () => {
        await wallet.addGuardian(guardian1, { from: owner });
        await wallet.addGuardian(guardian2, { from: owner });
        await truffleAssert.reverts(wallet.confirmGuardianAddition(guardian2),
          "GM: Too early to confirm guardian addition");
      });

      it.skip("should let the owner re-add EOA Guardians after missing the confirmation window (blockchain transaction)", async () => {
        await wallet.addGuardian(guardian1, { from: owner });

        // first time
        await wallet.addGuardian(guardian2, { from: owner });

        await utilities.increaseTime(SECURITY_WINDOW * 2);
        await truffleAssert.reverts(wallet.confirmGuardianAddition(guardian2), "GM: Too late to confirm guardian addition");

        // second time
        await wallet.addGuardian(guardian2, { from: owner });
        let count = (await wallet.guardianCount()).toNumber();
        let active = await wallet.isGuardian(guardian2);
        assert.isFalse(active, "second guardian should not yet be active");
        assert.equal(count, 1, "second guardian should be pending during security period");

        await utilities.increaseTime(SECURITY_WINDOW + 1);
        await wallet.confirmGuardianAddition(guardian2);
        count = (await wallet.guardianCount()).toNumber();
        active = await wallet.isGuardian(guardian2);
        assert.isTrue(active, "second guardian should be active");
        assert.equal(count, 2, "2 guardians should be active after security period");
      });

      it("should only let the owner add an EOA guardian", async () => {
        await truffleAssert.reverts(wallet.addGuardian(guardian1, { from: nonowner }), "BM: must be wallet owner");
      });

      it("should not allow adding wallet owner as guardian", async () => {
        await truffleAssert.reverts(wallet.addGuardian(owner, { from: owner }), "GM: target guardian cannot be owner");
      });

      it("should not allow adding an existing guardian twice", async () => {
        await wallet.addGuardian(guardian1, { from: owner });
        await truffleAssert.reverts(wallet.addGuardian(guardian1, { from: owner }), "GM: target is already a guardian");
      });

      it("should not allow adding a duplicate request to add a guardian to the request queue", async () => {
        await wallet.addGuardian(guardian1, { from: owner });
        await wallet.addGuardian(guardian2, { from: owner });
        await truffleAssert.reverts(wallet.addGuardian(guardian2, { from: owner }),
          "GM: addition of target as guardian is already pending");
      });

      it("should let the owner add an EOA guardian (relayed transaction)", async () => {
        await manager.relay(wallet, "addGuardian", [guardian1], [owner]);
        const count = (await wallet.guardianCount()).toNumber();
        const active = await wallet.isGuardian(guardian1);
        assert.isTrue(active, "first guardian should be active");
        assert.equal(count, 1, "1 guardian should be active");
      });

      it("should add many Guardians (blockchain transaction)", async () => {
        const guardians = [guardian1, guardian2, guardian3, guardian4, guardian5];
        let count;
        let active;
        for (let i = 1; i <= 5; i += 1) {
          await wallet.addGuardian(guardians[i - 1], { from: owner });
          if (i > 1) {
            await utilities.increaseTime(SECURITY_WINDOW + 1);
            await wallet.confirmGuardianAddition(guardians[i - 1]);
          }
          count = (await wallet.guardianCount()).toNumber();
          active = await wallet.isGuardian(guardians[i - 1]);
          assert.equal(count, i, `guardian ${i} should be added`);
          assert.isTrue(active, `guardian ${i} should be active`);
        }
      });

      it("should add many Guardians (relayed transaction)", async () => {
        const guardians = [guardian1, guardian2, guardian3, guardian4, guardian5];
        let count;
        let active;
        for (let i = 1; i <= 3; i += 1) {
          await manager.relay(wallet, "addGuardian", [guardians[i - 1]], [owner]);
          if (i > 1) {
            await utilities.increaseTime(SECURITY_WINDOW + 1);
            await manager.relay(wallet, "confirmGuardianAddition", [guardians[i - 1]], []);
          }
          count = (await wallet.guardianCount()).toNumber();
          active = await wallet.isGuardian(guardians[i - 1]);
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
        const proxy = await DelegateProxy.new({ from: guardian1 });
        await proxy.setRegistry(registry.address, { from: guardian1 });
        guardianWallet1 = await IWallet.at(proxy.address);

        const proxy2 = await DelegateProxy.new({ from: guardian2 });
        await proxy2.setRegistry(registry.address, { from: guardian2 });
        guardianWallet2 = await IWallet.at(proxy2.address);

        dumbContract = await DumbContract.new();
      });

      it("should let the owner add Smart Contract Guardians (blockchain transaction)", async () => {
        await wallet.addGuardian(guardianWallet1.address, { from: owner });
        let count = (await wallet.guardianCount()).toNumber();
        let active = await wallet.isGuardianOrGuardianSigner(guardian1);
        assert.isTrue(active, "first guardian owner should be recognized as guardian");
        active = await wallet.isGuardian(guardianWallet1.address);
        assert.isTrue(active, "first guardian should be recognized as guardian");
        assert.equal(count, 1, "1 guardian should be active");

        await wallet.addGuardian(guardianWallet2.address, { from: owner });
        count = (await wallet.guardianCount()).toNumber();
        active = await wallet.isGuardianOrGuardianSigner(guardian2);
        assert.isFalse(active, "second guardian owner should not yet be active");
        active = await wallet.isGuardian(guardianWallet2.address);
        assert.isFalse(active, "second guardian should not yet be active");
        assert.equal(count, 1, "second guardian should be pending during security period");

        await utilities.increaseTime(SECURITY_WINDOW + 1);
        await wallet.confirmGuardianAddition(guardianWallet2.address);
        count = (await wallet.guardianCount()).toNumber();
        assert.equal(count, 2, "2 guardians should be active after security period");
        active = await wallet.isGuardianOrGuardianSigner(guardian2);
        assert.isTrue(active, "second guardian owner should be active");
        active = await wallet.isGuardian(guardianWallet2.address);
        assert.isTrue(active, "second guardian should be active");
      });

      it("should let the owner add a Smart Contract guardian (relayed transaction)", async () => {
        await manager.relay(wallet, "addGuardian", [guardianWallet1.address], [owner]);
        const count = (await wallet.guardianCount()).toNumber();
        let active = await wallet.isGuardian(guardianWallet1.address);
        assert.isTrue(active, "first guardian should be active");
        active = await wallet.isGuardianOrGuardianSigner(guardian1);
        assert.isTrue(active, "first guardian owner should be active");
        assert.equal(count, 1, "1 guardian should be active");
      });

      it("should not let owner add a Smart Contract guardian that does not have an owner manager", async () => {
        await truffleAssert.reverts(wallet.addGuardian(dumbContract.address, { from: owner }),
          "GM: guardian must be EOA or implement owner()");
      });

      it("it should fail to add a non-compliant guardian", async () => {
        await wallet.addGuardian(guardian1, { from: owner });
        const nonCompliantGuardian = await NonCompliantGuardian.new();
        await truffleAssert.reverts(wallet.addGuardian(nonCompliantGuardian.address, { from: owner }),
          "GM: guardian must be EOA or implement owner()");
      });
    });
  });

  describe("Revoking Guardians", () => {
    beforeEach(async () => {
      await wallet.addGuardian(guardian1, { from: owner });
      await wallet.addGuardian(guardian2, { from: owner });
      await utilities.increaseTime(SECURITY_WINDOW + 1);
      await wallet.confirmGuardianAddition(guardian2);
      const count = (await wallet.guardianCount()).toNumber();
      assert.equal(count, 2, "2 guardians should be added");
    });

    it("should revoke a guardian (blockchain transaction)", async () => {
      await wallet.revokeGuardian(guardian1, { from: owner });
      let count = (await wallet.guardianCount()).toNumber();
      let active = await wallet.isGuardian(guardian1);
      assert.isTrue(active, "the revoked guardian should still be active during the security period");
      assert.equal(count, 2, "the revoked guardian should go through a security period");

      await utilities.increaseTime(SECURITY_WINDOW + 1);
      await wallet.confirmGuardianRevokation(guardian1);
      count = (await wallet.guardianCount()).toNumber();
      active = await wallet.isGuardian(guardian1);
      assert.isFalse(active, "the revoked guardian should no longer be active after the security period");
      assert.equal(count, 1, "the revoked guardian should be removed after the security period");
    });

    it("should not be able to revoke a nonexistent guardian", async () => {
      await truffleAssert.reverts(wallet.revokeGuardian(nonowner, { from: owner }),
        "GM: must be an existing guardian");
    });

    it("should not confirm a guardian revokation too early", async () => {
      await wallet.revokeGuardian(guardian1, { from: owner });
      await truffleAssert.reverts(wallet.confirmGuardianRevokation(guardian1),
        "GM: Too early to confirm guardian revokation");
    });

    it("should not confirm a guardian revokation after two security periods (blockchain transaction)", async () => {
      await wallet.revokeGuardian(guardian1, { from: owner });

      await utilities.increaseTime(SECURITY_WINDOW * 2);
      await truffleAssert.reverts(wallet.confirmGuardianRevokation(guardian1),
        "GM: Too late to confirm guardian revokation");
    });

    it("should not be able to revoke a guardian twice", async () => {
      await wallet.revokeGuardian(guardian1, { from: owner });
      await truffleAssert.reverts(wallet.revokeGuardian(guardian1, { from: owner }),
        "GM: revokation of target as guardian is already pending");
    });

    it.skip("should revoke a guardian again after missing the confirmation window the first time (blockchain transaction)", async () => {
      // first time
      await wallet.revokeGuardian(guardian1, { from: owner });

      await utilities.increaseTime(SECURITY_WINDOW * 2);
      await truffleAssert.reverts(wallet.confirmGuardianRevokation(guardian1),
        "GM: Too late to confirm guardian revokation");

      // second time
      await wallet.revokeGuardian(guardian1, { from: owner });
      let count = (await wallet.guardianCount()).toNumber();
      let active = await wallet.isGuardian(guardian1);
      assert.isTrue(active, "the revoked guardian should still be active during the security period");
      assert.equal(count, 2, "the revoked guardian should go through a security period");

      await utilities.increaseTime(SECURITY_WINDOW + 1);
      await wallet.confirmGuardianRevokation(guardian1);
      count = (await wallet.guardianCount()).toNumber();
      active = await wallet.isGuardian(guardian1);
      assert.isFalse(active, "the revoked guardian should no longer be active after the security period");
      assert.equal(count, 1, "the revoked guardian should be removed after the security period");
    });

    it("should add a guardian after a revoke (blockchain transaction)", async () => {
      await wallet.revokeGuardian(guardian1, { from: owner });
      await utilities.increaseTime(SECURITY_WINDOW + 1);
      await wallet.confirmGuardianRevokation(guardian1);
      let count = (await wallet.guardianCount()).toNumber();
      assert.equal(count, 1, "there should be 1 guardian left");

      await wallet.addGuardian(guardian3, { from: owner });
      await utilities.increaseTime(SECURITY_WINDOW + 1);
      await wallet.confirmGuardianAddition(guardian3);
      count = (await wallet.guardianCount()).toNumber();
      assert.equal(count, 2, "there should be 2 guardians again");
    });

    it("should be able to remove a guardian that is the last in the list", async () => {
      await wallet.addGuardian(guardian3, { from: owner });
      await utilities.increaseTime(SECURITY_WINDOW + 1);
      await wallet.confirmGuardianAddition(guardian3);
      let count = await wallet.guardianCount();
      assert.equal(count.toNumber(), 3, "there should be 3 guardians");

      const guardians = await wallet.getGuardians();
      await wallet.revokeGuardian(guardians[2], { from: owner });
      await utilities.increaseTime(SECURITY_WINDOW + 1);
      await wallet.confirmGuardianRevokation(guardians[2]);
      count = await wallet.guardianCount();
      assert.equal(count.toNumber(), 2, "there should be 2 guardians left");
    });
  });

  describe("Cancelling Pending Guardians", () => {
    beforeEach(async () => {
      await wallet.addGuardian(guardian1, { from: owner });
      const count = (await wallet.guardianCount()).toNumber();
      assert.equal(count, 1, "1 guardian should be added");
    });

    it("owner should be able to cancel pending addition of guardian (blockchain transaction)", async () => {
      // Add guardian 2 and cancel its addition
      await wallet.addGuardian(guardian2, { from: owner });
      await wallet.cancelGuardianAddition(guardian2, { from: owner });
      await utilities.increaseTime(SECURITY_WINDOW + 1);
      await truffleAssert.reverts(wallet.confirmGuardianAddition(guardian2), "GM: no pending addition as guardian for target");
    });

    it("owner should not be able to cancel a nonexistent addition of a guardian request", async () => {
      await truffleAssert.reverts(wallet.cancelGuardianAddition(guardian2, { from: owner }),
        "GM: no pending addition as guardian for target");
    });

    it("owner should be able to cancel pending revokation of guardian (blockchain transaction)", async () => {
      // Revoke guardian 1 and cancel its revokation
      await wallet.revokeGuardian(guardian1, { from: owner });
      await wallet.cancelGuardianRevokation(guardian1, { from: owner });
      await utilities.increaseTime(SECURITY_WINDOW + 1);
      await truffleAssert.reverts(wallet.confirmGuardianRevokation(guardian1), "GM: no pending guardian revokation for target");
    });

    it("owner should not be able to cancel a nonexistent pending revokation of guardian", async () => {
      await truffleAssert.reverts(wallet.cancelGuardianRevokation(nonowner, { from: owner }),
        "GM: no pending guardian revokation for target");
    });

    it("owner should be able to cancel pending addition of guardian (relayed transaction)", async () => {
      // Add guardian 2 and cancel its addition
      await manager.relay(wallet, "addGuardian", [guardian2], [owner]);
      await manager.relay(wallet, "cancelGuardianAddition", [guardian2], [owner]);
      await utilities.increaseTime(SECURITY_WINDOW + 1);
      await truffleAssert.reverts(wallet.confirmGuardianAddition(guardian2),
        "GM: no pending addition as guardian for target");
    });

    it("owner should be able to cancel pending revokation of guardian (relayed transaction)", async () => {
      // Revoke guardian 1 and cancel its revokation
      await manager.relay(wallet, "revokeGuardian", [guardian1], [owner]);
      await manager.relay(wallet, "cancelGuardianRevokation", [guardian1], [owner]);
      await utilities.increaseTime(SECURITY_WINDOW + 1);
      await truffleAssert.reverts(wallet.confirmGuardianRevokation(guardian1), "GM: no pending guardian revokation for target");
    });
  });

  describe("Guardian Storage", () => {
    it("should not allow non modules to addGuardian", async () => {
      await truffleAssert.reverts(wallet.addGuardian(guardian4), "BM: must be wallet owner");
    });

    it("should not allow non modules to revokeGuardian", async () => {
      await truffleAssert.reverts(wallet.revokeGuardian(guardian1), "BM: must be wallet owner");
    });
  });
});
