/* global artifacts */
const ethers = require("ethers");
const truffleAssert = require("truffle-assertions");

const Managed = artifacts.require("Managed");

contract("Managed and Owned", (accounts) => {
  const infrastructure = accounts[0];
  const manager1 = accounts[1];
  const manager2 = accounts[2];
  const nonOwner = accounts[3];

  let managed;

  beforeEach(async () => {
    managed = await Managed.new();
  });

  describe("Owned contract logic", () => {
    it("should set owner to caller", async () => {
      const owner = await managed.owner();
      assert.equal(owner, infrastructure);
    });

    it("should be able to change owner", async () => {
      const newOwner = accounts[1];
      await managed.changeOwner(newOwner);
      const owner = await managed.owner();
      assert.equal(owner, newOwner);
    });

    it("should not be able to change owner to zero address", async () => {
      await truffleAssert.reverts(managed.changeOwner(ethers.constants.AddressZero), "Address must not be null");
    });
  });

  describe("Managed contract logic", () => {
    it("should be able to add manager", async () => {
      // Ensure the manager test accounts are not managers to start with
      let isManager1 = await managed.managers(manager1);
      assert.isFalse(isManager1);
      let isManager2 = await managed.managers(manager2);
      assert.isFalse(isManager2);

      // Add managers
      await managed.addManager(manager1);
      await managed.addManager(manager2);

      isManager1 = await managed.managers(manager1);
      assert.isTrue(isManager1);
      isManager2 = await managed.managers(manager2);
      assert.isTrue(isManager2);
    });

    it("should not be able to add manager if not called by owner", async () => {
      await truffleAssert.reverts(managed.addManager(manager1, { from: nonOwner }), "Must be owner");
    });

    it("should not be able to set manager to zero address", async () => {
      await truffleAssert.reverts(managed.addManager(ethers.constants.AddressZero), "M: Address must not be null");
    });

    it("should be able to set manager twice without error", async () => {
      // Set manager once
      await managed.addManager(manager1);
      let isManager1 = await managed.managers(manager1);
      assert.isTrue(isManager1);

      // Set manager twice
      await managed.addManager(manager1);
      isManager1 = await managed.managers(manager1);
      assert.isTrue(isManager1);
    });

    it("should be able to revoke manager", async () => {
      // Add managers
      await managed.addManager(manager1);
      await managed.addManager(manager2);

      // Revoke only the second manager
      await managed.revokeManager(manager2);

      const isManager1 = await managed.managers(manager1);
      assert.isTrue(isManager1);
      const isManager2 = await managed.managers(manager2);
      assert.isFalse(isManager2);
    });

    it("should not be able to revoke manager if not called by owner", async () => {
      await managed.addManager(manager1);
      await truffleAssert.reverts(managed.revokeManager(manager1, { from: nonOwner }), "Must be owner");
    });

    it("should not be able to revoke a nonexisting managerr", async () => {
      await truffleAssert.reverts(managed.revokeManager(manager2), "M: Target must be an existing manager");
    });
  });
});
