/* global artifacts */
const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { assert } = chai;
chai.use(bnChai(BN));

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const TransferStorage = artifacts.require("TransferStorage");
const GuardianStorage = artifacts.require("GuardianStorage");
const ArgentModule = artifacts.require("ArgentModule");
const Authoriser = artifacts.require("DappRegistry");
const UniswapV2Router01 = artifacts.require("DummyUniV2Router");
const DumbContract = artifacts.require("TestContract");

const utils = require("../utils/utilities.js");
const { ARGENT_WHITELIST } = require("../utils/utilities.js");

const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 24;
const SECURITY_WINDOW = 12;
const LOCK_PERIOD = 50;
const RECOVERY_PERIOD = 36;

const RelayManager = require("../utils/relay-manager");

contract("GuardianManager", (accounts) => {
    let manager;

    const infrastructure = accounts[0];
    const owner = accounts[1];
    const guardian1 = accounts[2];
    const guardian2 = accounts[3];
    const guardian3 = accounts[4];
    const guardian4 = accounts[5];
    const guardian5 = accounts[6];
    const nonowner = accounts[7];
    const relayer = accounts[9];
  
    let registry;
    let guardianStorage;
    let transferStorage;
    let module;
    let wallet;
    let walletImplementation;
    let authoriser;

  before(async () => {
    registry = await Registry.new();

    guardianStorage = await GuardianStorage.new();
    transferStorage = await TransferStorage.new();

    authoriser = await Authoriser.new();

    const uniswapRouter = await UniswapV2Router01.new();

    module = await ArgentModule.new(
      registry.address,
      guardianStorage.address,
      transferStorage.address,
      authoriser.address,
      uniswapRouter.address,
      SECURITY_PERIOD,
      SECURITY_WINDOW,
      RECOVERY_PERIOD,
      LOCK_PERIOD);

    await registry.registerModule(module.address, ethers.utils.formatBytes32String("ArgentModule"));
    await authoriser.addAuthorisationToRegistry(ARGENT_WHITELIST, relayer, ZERO_ADDRESS);

    walletImplementation = await BaseWallet.new();

    manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);

    await wallet.send(new BN("1000000000000000000"));
  });

  describe("Adding Guardians", () => {
    describe("EOA Guardians", () => {
      it("should let the owner add EOA Guardians", async () => {
        await module.addGuardian(wallet.address, guardian1, { from: owner });
        let count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        let active = await module.isGuardian(wallet.address, guardian1);
        assert.isTrue(active, "first guardian should be active");
        assert.equal(count, 1, "1 guardian should be active");

        await module.addGuardian(wallet.address, guardian2, { from: owner });
        count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        active = await module.isGuardian(wallet.address, guardian2);
        assert.isFalse(active, "second guardian should not yet be active");
        assert.equal(count, 1, "second guardian should be pending during security period");

        await utils.increaseTime(30);
        await module.confirmGuardianAddition(wallet.address, guardian2);
        count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        active = await module.isGuardian(wallet.address, guardian2);
        const guardians = await module.getGuardians(wallet.address);
        assert.isTrue(active, "second guardian should be active");
        assert.equal(count, 2, "2 guardians should be active after security period");
        assert.equal(guardian1, guardians[0], "should return first guardian address");
        assert.equal(guardian2, guardians[1], "should return second guardian address");
      });

      it("should not let the owner add EOA Guardians after two security periods (blockchain transaction)", async () => {
        await module.addGuardian(wallet.address, guardian1, { from: owner });
        await module.addGuardian(wallet.address, guardian2, { from: owner });

        await utils.increaseTime(48); // 42 == 2 * security_period
        await truffleAssert.reverts(module.confirmGuardianAddition(wallet.address, guardian2),
          "SM: pending addition expired");

        const count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        const active = await module.isGuardian(wallet.address, guardian2);
        assert.isFalse(active, "second guardian should not be active (addition confirmation was too late)");
        assert.equal(count, 1, "1 guardian should be active after two security periods (addition confirmation was too late)");
      });

      it("should not allow confirming too early", async () => {
        await module.addGuardian(wallet.address, guardian1, { from: owner });
        await module.addGuardian(wallet.address, guardian2, { from: owner });
        await truffleAssert.reverts(module.confirmGuardianAddition(wallet.address, guardian2),
          "SM: pending addition not over");
      });

      it("should let the owner re-add EOA Guardians after missing the confirmation window", async () => {
        await module.addGuardian(wallet.address, guardian1, { from: owner });

        // first time
        await module.addGuardian(wallet.address, guardian2, { from: owner });

        await utils.increaseTime(48); // 42 == 2 * security_period
        await truffleAssert.reverts(module.confirmGuardianAddition(wallet.address, guardian2),
          "SM: pending addition expired");

        // second time
        await module.addGuardian(wallet.address, guardian2, { from: owner });
        let count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        let active = await module.isGuardian(wallet.address, guardian2);
        assert.isFalse(active, "second guardian should not yet be active");
        assert.equal(count, 1, "second guardian should be pending during security period");

        await utils.increaseTime(30);
        await module.confirmGuardianAddition(wallet.address, guardian2);
        count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        active = await module.isGuardian(wallet.address, guardian2);
        assert.isTrue(active, "second guardian should be active");
        assert.equal(count, 2, "2 guardians should be active after security period");
      });

      it("should only let the owner add an EOA guardian", async () => {
        await truffleAssert.reverts(module.addGuardian(wallet.address, guardian1, { from: nonowner }),
          "BM: must be wallet owner/self");
      });

      it("should not allow adding wallet owner as guardian", async () => {
        await truffleAssert.reverts(module.addGuardian(wallet.address, owner, { from: owner }),
          "SM: guardian cannot be owner");
      });

      it("should not allow adding an existing guardian twice", async () => {
        await module.addGuardian(wallet.address, guardian1, { from: owner });
        await truffleAssert.reverts(module.addGuardian(wallet.address, guardian1, { from: owner }),
          "SM: duplicate guardian");
      });

      it("should not allow adding a duplicate request to add a guardian to the request queue", async () => {
        await module.addGuardian(wallet.address, guardian1, { from: owner });
        await module.addGuardian(wallet.address, guardian2, { from: owner });
        await truffleAssert.reverts(module.addGuardian(wallet.address, guardian2, { from: owner }),
          "SM: duplicate pending addition");
      });

      it("should add many Guardians", async () => {
        const guardians = [guardian1, guardian2, guardian3, guardian4, guardian5];
        let count;
        let active;
        for (let i = 1; i <= 3; i += 1) {
          await manager.relay(module, "addGuardian", [wallet.address, guardians[i - 1]], wallet, [owner]);
          if (i > 1) {
            await utils.increaseTime(30);
            await manager.relay(module, "confirmGuardianAddition", [wallet.address, guardians[i - 1]], wallet, []);
          }
          count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
          active = await module.isGuardian(wallet.address, guardians[i - 1]);
          assert.equal(count, i, `guardian ${i} should be added`);
          assert.isTrue(active, `guardian ${i} should be active`);
        }
      });
    });

    describe("Smart Contract Guardians", () => {
      let guardianWallet1;
      let guardianWallet2;
      let nonCompliantGuardian;

      beforeEach(async () => {
        const proxy1 = await Proxy.new(walletImplementation.address);
        guardianWallet1 = await BaseWallet.at(proxy1.address);
        await guardianWallet1.init(guardian1, [module.address]);

        const proxy2 = await Proxy.new(walletImplementation.address);
        guardianWallet2 = await BaseWallet.at(proxy2.address);
        await guardianWallet2.init(guardian2, [module.address]);
        nonCompliantGuardian = await DumbContract.new();
      });

      it("should let the owner add a Smart Contract guardian", async () => {
        await manager.relay(module, "addGuardian", [wallet.address, guardianWallet1.address], wallet, [owner]);
        const count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
        let active = await module.isGuardian(wallet.address, guardianWallet1.address);
        assert.isTrue(active, "first guardian should be active");
        active = await module.isGuardianOrGuardianSigner(wallet.address, guardian1);
        assert.isTrue(active, "first guardian owner should be active");
        assert.equal(count, 1, "1 guardian should be active");
      });

      it("it should fail to add a non-compliant guardian", async () => {
        await module.addGuardian(wallet.address, guardian1, { from: owner });
        await truffleAssert.reverts(module.addGuardian(wallet.address, nonCompliantGuardian.address, { from: owner }),
          "SM: must be EOA/Argent wallet");
      });
    });
  });

  describe("Revoking Guardians", () => {
    beforeEach(async () => {
      await module.addGuardian(wallet.address, guardian1, { from: owner });
      await module.addGuardian(wallet.address, guardian2, { from: owner });
      await utils.increaseTime(30);
      await module.confirmGuardianAddition(wallet.address, guardian2);
      const count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      assert.equal(count, 2, "2 guardians should be added");
    });

    it("should revoke a guardian (blockchain transaction)", async () => {
      await module.revokeGuardian(wallet.address, guardian1, { from: owner });
      let count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      let active = await module.isGuardian(wallet.address, guardian1);
      assert.isTrue(active, "the revoked guardian should still be active during the security period");
      assert.equal(count, 2, "the revoked guardian should go through a security period");

      await utils.increaseTime(30);
      await module.confirmGuardianRevokation(wallet.address, guardian1);
      count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      active = await module.isGuardian(wallet.address, guardian1);
      assert.isFalse(active, "the revoked guardian should no longer be active after the security period");
      assert.equal(count, 1, "the revoked guardian should be removed after the security period");
    });

    it("should not be able to revoke a nonexistent guardian", async () => {
      await truffleAssert.reverts(module.revokeGuardian(wallet.address, nonowner, { from: owner }),
        "SM: must be existing guardian");
    });

    it("should not confirm a guardian revokation too early", async () => {
      await module.revokeGuardian(wallet.address, guardian1, { from: owner });
      await truffleAssert.reverts(module.confirmGuardianRevokation(wallet.address, guardian1),
        "SM: pending revoke not over");
    });

    it("should not confirm a guardian revokation after two security periods (blockchain transaction)", async () => {
      await module.revokeGuardian(wallet.address, guardian1, { from: owner });

      await utils.increaseTime(48); // 48 == 2 * security_period
      await truffleAssert.reverts(module.confirmGuardianRevokation(wallet.address, guardian1),
        "SM: pending revoke expired");
    });

    it("should not be able to revoke a guardian twice", async () => {
      await module.revokeGuardian(wallet.address, guardian1, { from: owner });
      await truffleAssert.reverts(module.revokeGuardian(wallet.address, guardian1, { from: owner }),
        "SM: duplicate pending revoke");
    });

    it("should revoke a guardian again after missing the confirmation window the first time (blockchain transaction)", async () => {
      // first time
      await module.revokeGuardian(wallet.address, guardian1, { from: owner });

      await utils.increaseTime(48); // 48 == 2 * security_period
      await truffleAssert.reverts(module.confirmGuardianRevokation(wallet.address, guardian1),
        "SM: pending revoke expired");

      // second time
      await module.revokeGuardian(wallet.address, guardian1, { from: owner });
      let count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      let active = await module.isGuardian(wallet.address, guardian1);
      assert.isTrue(active, "the revoked guardian should still be active during the security period");
      assert.equal(count, 2, "the revoked guardian should go through a security period");

      await utils.increaseTime(30);
      await module.confirmGuardianRevokation(wallet.address, guardian1);
      count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      active = await module.isGuardian(wallet.address, guardian1);
      assert.isFalse(active, "the revoked guardian should no longer be active after the security period");
      assert.equal(count, 1, "the revoked guardian should be removed after the security period");
    });

    it("should add a guardian after a revoke (blockchain transaction)", async () => {
      await module.revokeGuardian(wallet.address, guardian1, { from: owner });
      await utils.increaseTime(30);
      await module.confirmGuardianRevokation(wallet.address, guardian1);
      let count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      assert.equal(count, 1, "there should be 1 guardian left");

      await module.addGuardian(wallet.address, guardian3, { from: owner });
      await utils.increaseTime(30);
      await module.confirmGuardianAddition(wallet.address, guardian3);
      count = (await guardianStorage.guardianCount(wallet.address)).toNumber();
      assert.equal(count, 2, "there should be 2 guardians again");
    });

    it("should be able to remove a guardian that is the last in the list", async () => {
      await module.addGuardian(wallet.address, guardian3, { from: owner });
      await utils.increaseTime(30);
      await module.confirmGuardianAddition(wallet.address, guardian3);
      let count = await guardianStorage.guardianCount(wallet.address);
      assert.equal(count.toNumber(), 3, "there should be 3 guardians");

      const guardians = await guardianStorage.getGuardians(wallet.address);
      await module.revokeGuardian(wallet.address, guardians[2], { from: owner });
      await utils.increaseTime(30);
      await module.confirmGuardianRevokation(wallet.address, guardians[2]);
      count = await guardianStorage.guardianCount(wallet.address);
      assert.equal(count.toNumber(), 2, "there should be 2 guardians left");
    });
  });

  describe("Cancelling Pending Guardians", () => {
    beforeEach(async () => {
      await module.addGuardian(wallet.address, guardian1, { from: owner });
      const count = (await module.guardianCount(wallet.address)).toNumber();
      assert.equal(count, 1, "1 guardian should be added");
    });

    it("owner should be able to cancel pending addition of guardian", async () => {
      // Add guardian 2 and cancel its addition
      await module.addGuardian(wallet.address, guardian2, { from: owner });
      await module.cancelGuardianAddition(wallet.address, guardian2, { from: owner });
      await utils.increaseTime(30);
      await truffleAssert.reverts(module.confirmGuardianAddition(wallet.address, guardian2),
        "SM: unknown pending addition");
    });

    it("owner should not be able to cancel a nonexistent addition of a guardian request", async () => {
      await truffleAssert.reverts(module.cancelGuardianAddition(wallet.address, guardian2, { from: owner }),
        "SM: unknown pending addition");
    });

    it("owner should be able to cancel pending revokation of guardian", async () => {
      // Revoke guardian 1 and cancel its revokation
      await module.revokeGuardian(wallet.address, guardian1, { from: owner });
      await module.cancelGuardianRevokation(wallet.address, guardian1, { from: owner });
      await utils.increaseTime(30);
      await truffleAssert.reverts(module.confirmGuardianRevokation(wallet.address, guardian1),
        "SM: unknown pending revoke");
    });

    it("owner should not be able to cancel a nonexistent pending revokation of guardian", async () => {
      await truffleAssert.reverts(module.cancelGuardianRevokation(wallet.address, nonowner, { from: owner }),
        "SM: unknown pending revoke");
    });
  });

  describe("Guardian Storage", () => {
    it("should not allow non modules to addGuardian", async () => {
      await truffleAssert.reverts(guardianStorage.addGuardian(wallet.address, guardian4),
        "TS: must be an authorized module to call this method");
    });

    it("should not allow non modules to revokeGuardian", async () => {
      await truffleAssert.reverts(guardianStorage.revokeGuardian(wallet.address, guardian1),
        "TS: must be an authorized module to call this method");
    });
  });
});
