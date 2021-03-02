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

const utils = require("../utils/utilities.js");

const ZERO_ADDRESS = ethers.constants.AddressZero;
const SECURITY_PERIOD = 24;
const SECURITY_WINDOW = 12;
const LOCK_PERIOD = 50;
const RECOVERY_PERIOD = 36;

const RelayManager = require("../utils/relay-manager");

const WRONG_SIGNATURE_NUMBER_REVERT_MSG = "RM: Wrong number of signatures";
const INVALID_SIGNATURES_REVERT_MSG = "RM: Invalid signatures";

contract("RecoveryManager", (accounts) => {
  let manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const guardian1 = accounts[2];
  const guardian2 = accounts[3];
  const guardian3 = accounts[4];
  const newowner = accounts[5];
  const nonowner = accounts[6];
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

    authoriser = await Authoriser.new(0);

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
    await authoriser.addDapp(0, relayer, ZERO_ADDRESS);

    walletImplementation = await BaseWallet.new();

    manager = new RelayManager(guardianStorage.address, ZERO_ADDRESS);
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner, [module.address]);

    await wallet.send(new BN("1000000000000000000"));
  });

  async function addGuardians(guardians) {
    // guardians can be BaseWallet or ContractWrapper objects
    for (const guardian of guardians) {
      await module.addGuardian(wallet.address, guardian, { from: owner });
    }

    await utils.increaseTime(30);
    for (let i = 1; i < guardians.length; i += 1) {
      await module.confirmGuardianAddition(wallet.address, guardians[i]);
    }
    const count = (await module.guardianCount(wallet.address)).toNumber();
    assert.equal(count, guardians.length, `${guardians.length} guardians should be added`);
  }

  async function createSmartContractGuardians(guardians) {
    const wallets = [];
    let guardian;
    for (guardian of guardians) {
      const proxy = await Proxy.new(walletImplementation.address);
      const guardianWallet = await BaseWallet.at(proxy.address);
      await guardianWallet.init(guardian, [module.address]);
      wallets.push(guardianWallet.address);
    }
    return wallets;
  }

  function testExecuteRecovery(guardians) {
    it("should let a majority of guardians execute the recovery procedure", async () => {
      const majority = guardians.slice(0, Math.ceil((guardians.length) / 2));
      await manager.relay(module, "executeRecovery", [wallet.address, newowner], wallet, utils.sortWalletByAddress(majority));
      const timestamp = await utils.getTimestamp();
      const isLocked = await module.isLocked(wallet.address);
      assert.isTrue(isLocked, "should be locked by recovery");

      const recoveryConfig = await module.getRecovery(wallet.address);
      const recoveryPeriod = new BN(RECOVERY_PERIOD);
      assert.equal(recoveryConfig._address, newowner);
      assert.closeTo(recoveryConfig._executeAfter.toNumber(), recoveryPeriod.add(new BN(timestamp)).toNumber(), 1);
      assert.equal(recoveryConfig._guardianCount, guardians.length);
    });

    it("should not let owner execute the recovery procedure", async () => {
      const expectedRevertMsg = guardians.length >= 3 ? WRONG_SIGNATURE_NUMBER_REVERT_MSG : INVALID_SIGNATURES_REVERT_MSG;
      await truffleAssert.reverts(
        manager.relay(
          module,
          "executeRecovery",
          [wallet.address, newowner],
          wallet,
          [owner],
        ), expectedRevertMsg,
      );
    });

    it("should not let a majority of guardians and owner execute the recovery procedure", async () => {
      const majority = guardians.slice(0, Math.ceil((guardians.length) / 2) - 1);
      await truffleAssert.reverts(
        manager.relay(
          module,
          "executeRecovery",
          [wallet.address, newowner],
          wallet,
          [owner, ...utils.sortWalletByAddress(majority)],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );

      const isLocked = await module.isLocked(wallet.address);
      assert.isFalse(isLocked, "should not be locked");
    });

    it("should not let a minority of guardians execute the recovery procedure", async () => {
      const minority = guardians.slice(0, Math.ceil((guardians.length) / 2) - 1);
      await truffleAssert.reverts(
        manager.relay(
          module,
          "executeRecovery",
          [wallet.address, newowner],
          wallet,
          utils.sortWalletByAddress(minority),
        ), WRONG_SIGNATURE_NUMBER_REVERT_MSG,
      );

      const isLocked = await module.isLocked(wallet.address);
      assert.isFalse(isLocked, "should not be locked");
    });
  }

  function testFinalizeRecovery() {
    it("should let anyone finalize the recovery procedure after the recovery period", async () => {
      await utils.increaseTime(40); // moving time to after the end of the recovery period
      await manager.relay(module, "finalizeRecovery", [wallet.address], wallet, []);
      const isLocked = await module.isLocked(wallet.address);
      assert.isFalse(isLocked, "should no longer be locked after finalization of recovery");
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, newowner, "wallet owner should have been changed");

      const recoveryConfig = await module.getRecovery(wallet.address);
      assert.equal(recoveryConfig._address, ethers.constants.AddressZero);
      assert.equal(recoveryConfig._executeAfter.toNumber(), 0);
      assert.equal(recoveryConfig._guardianCount, 0);
    });

    it("should not let anyone finalize the recovery procedure before the end of the recovery period", async () => {
      const txReceipt = await manager.relay(module, "finalizeRecovery", [wallet.address], wallet, []);
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, "SM: ongoing recovery period");

      const isLocked = await module.isLocked(wallet.address);
      assert.isTrue(isLocked, "should still be locked");
    });
  }

  function testCancelRecovery() {
    it("should let 2 guardians cancel the recovery procedure", async () => {
      await manager.relay(module, "cancelRecovery", [wallet.address], wallet, utils.sortWalletByAddress([guardian1, guardian2]));
      const isLocked = await module.isLocked(wallet.address);
      assert.isFalse(isLocked, "should no longer be locked by recovery");
      await utils.increaseTime(40); // moving time to after the end of the recovery period
      const txReceipt = await manager.relay(module, "finalizeRecovery", [wallet.address], wallet, []);
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, "SM: no ongoing recovery");
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "wallet owner should not have been changed");

      const recoveryConfig = await module.getRecovery(wallet.address);
      assert.equal(recoveryConfig._address, ethers.constants.AddressZero);
      assert.equal(recoveryConfig._executeAfter.toNumber(), 0);
      assert.equal(recoveryConfig._guardianCount, 0);
    });

    it("should let 1 guardian + owner cancel the recovery procedure", async () => {
      await manager.relay(module, "cancelRecovery", [wallet.address], wallet, [owner, guardian1]);
      const isLocked = await module.isLocked(wallet.address);
      assert.isFalse(isLocked, "should no longer be locked by recovery");
      await utils.increaseTime(40); // moving time to after the end of the recovery period
      const txReceipt = await manager.relay(module, "finalizeRecovery", [wallet.address], wallet, []);
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "finalization should have failed");
      assert.equal(error, "SM: no ongoing recovery");
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "wallet owner should not have been changed");
    });

    it("should not let 1 guardian cancel the recovery procedure", async () => {
      await truffleAssert.reverts(
        manager.relay(
          module,
          "cancelRecovery",
          [wallet.address],
          wallet,
          [guardian1],
        ), WRONG_SIGNATURE_NUMBER_REVERT_MSG,
      );

      const isLocked = await module.isLocked(wallet.address);
      assert.isTrue(isLocked, "should still be locked");
    });

    it("should not let the owner cancel the recovery procedure", async () => {
      await truffleAssert.reverts(
        manager.relay(
          module,
          "cancelRecovery",
          [wallet.address],
          wallet,
          [owner],
        ), WRONG_SIGNATURE_NUMBER_REVERT_MSG,
      );

      const isLocked = await module.isLocked(wallet.address);
      assert.isTrue(isLocked, "should still be locked");
    });

    it("should not allow duplicate guardian signatures", async () => {
      await truffleAssert.reverts(
        manager.relay(
          module,
          "cancelRecovery",
          [wallet.address],
          wallet,
          [guardian1, guardian1],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );

      const isLocked = await module.isLocked(wallet.address);
      assert.isTrue(isLocked, "should still be locked");
    });

    it("should not allow non guardians signatures", async () => {
      await truffleAssert.reverts(
        manager.relay(
          module,
          "cancelRecovery",
          [wallet.address],
          wallet,
          utils.sortWalletByAddress([guardian1, nonowner]),
        ), INVALID_SIGNATURES_REVERT_MSG,
      );

      const isLocked = await module.isLocked(wallet.address);
      assert.isTrue(isLocked, "should still be locked");
    });
  }

  function testOwnershipTransfer(guardians) {
    it("should let owner + the majority of guardians execute an ownership transfer", async () => {
      const majority = guardians.slice(0, Math.ceil((guardians.length) / 2));

      await manager.relay(module, "transferOwnership",
        [wallet.address, newowner], wallet, [owner, ...utils.sortWalletByAddress(majority)]);
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, newowner, "owner should have been changed");
    });

    it("should not let owner + minority of guardians execute an ownership transfer", async () => {
      const minority = guardians.slice(0, Math.ceil((guardians.length) / 2) - 1);
      await truffleAssert.reverts(
        manager.relay(
          module,
          "transferOwnership",
          [wallet.address, newowner],
          wallet,
          [owner, ...utils.sortWalletByAddress(minority)],
        ), WRONG_SIGNATURE_NUMBER_REVERT_MSG,
      );

      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "owner should not have been changed");
    });

    it("should not let majority of guardians execute an ownership transfer without owner", async () => {
      const majority = guardians.slice(0, Math.ceil((guardians.length) / 2));
      await truffleAssert.reverts(
        manager.relay(
          module,
          "transferOwnership",
          [wallet.address, newowner],
          wallet,
          [...utils.sortWalletByAddress(majority)],
        ), WRONG_SIGNATURE_NUMBER_REVERT_MSG,
      );

      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "owner should not have been changed");
    });
  }

  describe("Execute Recovery", () => {
    it("should not allow recovery to be executed with no guardians", async () => {
      const noGuardians = [];
      await truffleAssert.reverts(manager.relay(
        module,
        "executeRecovery",
        [wallet.address, newowner],
        wallet,
        noGuardians,
      ), "AM: no guardians set on wallet");

      const isLocked = await module.isLocked(wallet.address);
      assert.isFalse(isLocked, "should not be locked by recovery");

      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "owner should have not changed");
    });

    describe("EOA Guardians: G = 2", () => {
      beforeEach(async () => {
        await addGuardians([guardian1, guardian2]);
      });

      testExecuteRecovery([guardian1, guardian2]);
    });

    describe("EOA Guardians: G = 3", () => {
      beforeEach(async () => {
        await addGuardians([guardian1, guardian2, guardian3]);
      });

      testExecuteRecovery([guardian1, guardian2, guardian3]);

      it("should not allow duplicate guardian signatures", async () => {
        const badMajority = [guardian1, guardian1];
        await truffleAssert.reverts(
          manager.relay(
            module,
            "executeRecovery",
            [wallet.address, newowner],
            wallet,
            [...utils.sortWalletByAddress(badMajority)],
          ), INVALID_SIGNATURES_REVERT_MSG,
        );
      });
    });

    describe("Smart Contract Guardians: G = 2", () => {
      let guardians;
      beforeEach(async () => {
        guardians = await createSmartContractGuardians([guardian1, guardian2]);
        await addGuardians(guardians);
      });

      testExecuteRecovery([guardian1, guardian2]);
    });

    describe("Smart Contract Guardians: G = 3", () => {
      let guardians;
      beforeEach(async () => {
        guardians = await createSmartContractGuardians([guardian1, guardian2, guardian3]);
        await addGuardians(guardians);
      });

      testExecuteRecovery([guardian1, guardian2, guardian3]);
    });

    describe("Safety checks", () => {
      beforeEach(async () => {
        await addGuardians([guardian1]);
      });

      it("should not be able to call executeRecovery with an empty recovery address", async () => {
        const txReceipt = await manager.relay(module, "executeRecovery",
          [wallet.address, ethers.constants.AddressZero], wallet, [guardian1]);
        const { success, error } = utils.parseRelayReceipt(txReceipt);
        assert.isFalse(success, "executeRecovery should fail");
        assert.equal(error, "SM: new owner cannot be null");
      });

      it("should not be able to call executeRecovery with a guardian address", async () => {
        const txReceipt = await manager.relay(module, "executeRecovery",
          [wallet.address, guardian1], wallet, [guardian1]);
        const { success, error } = utils.parseRelayReceipt(txReceipt);
        assert.isFalse(success, "executeRecovery should fail");
        assert.equal(error, "SM: new owner cannot be guardian");
      });

      it("should not be able to call executeRecovery if already in the process of Recovery", async () => {
        await manager.relay(module, "executeRecovery",
          [wallet.address, newowner], wallet, utils.sortWalletByAddress([guardian1]));

        const txReceipt = await manager.relay(module, "executeRecovery",
          [wallet.address, ethers.constants.AddressZero], wallet, [guardian1]);
        const { success, error } = utils.parseRelayReceipt(txReceipt);
        assert.isFalse(success, "executeRecovery should fail");
        assert.equal(error, "SM: ongoing recovery");
      });
    });
  });

  describe("Finalize Recovery", () => {
    beforeEach(async () => {
      await addGuardians([guardian1, guardian2, guardian3]);
      await manager.relay(
        module,
        "executeRecovery",
        [wallet.address, newowner],
        wallet,
        utils.sortWalletByAddress([guardian1, guardian2]),
      );
    });

    testFinalizeRecovery();
  });

  describe("Cancel Recovery with 3 guardians", () => {
    describe("EOA Guardians", () => {
      beforeEach(async () => {
        await addGuardians([guardian1, guardian2, guardian3]);
        await manager.relay(
          module,
          "executeRecovery",
          [wallet.address, newowner],
          wallet,
          utils.sortWalletByAddress([guardian1, guardian2]),
        );
      });

      testCancelRecovery();
    });
    describe("Smart Contract Guardians", () => {
      beforeEach(async () => {
        const scGuardians = await createSmartContractGuardians([guardian1, guardian2, guardian3]);
        await addGuardians(scGuardians);
        await manager.relay(
          module,
          "executeRecovery",
          [wallet.address, newowner],
          wallet,
          utils.sortWalletByAddress([guardian1, guardian2]),
        );
      });

      testCancelRecovery();
    });
  });

  describe("Ownership Transfer", () => {
    it("should not allow transfer to an empty address", async () => {
      await addGuardians([guardian1]);
      const txReceipt = await manager.relay(
        module,
        "transferOwnership",
        [wallet.address, ethers.constants.AddressZero], wallet, [owner, guardian1],
      );
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "transferOwnership should fail");
      assert.equal(error, "SM: new owner cannot be null");
    });

    it("should not allow transfer to a guardian address", async () => {
      await addGuardians([guardian1]);
      const txReceipt = await manager.relay(
        module,
        "transferOwnership",
        [wallet.address, guardian1], wallet, [owner, guardian1],
      );
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "transferOwnership should fail");
      assert.equal(error, "SM: new owner cannot be guardian");
    });

    it("when no guardians, owner should be able to transfer alone", async () => {
      const txReceipt = await manager.relay(
        module,
        "transferOwnership",
        [wallet.address, newowner],
        wallet,
        [owner],
      );
      const { success } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, "transferOwnership should succeed");
    });

    it("should not allow owner not signing", async () => {
      await addGuardians([guardian1]);
      await truffleAssert.reverts(
        manager.relay(
          module,
          "transferOwnership",
          [wallet.address, newowner],
          wallet,
          [nonowner, guardian1],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );
    });

    it("should not allow duplicate owner signatures", async () => {
      await addGuardians([guardian1]);
      await truffleAssert.reverts(
        manager.relay(
          module,
          "transferOwnership",
          [wallet.address, newowner],
          wallet,
          [owner, owner],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );
    });

    it("should not allow duplicate guardian signatures", async () => {
      await addGuardians([guardian1, guardian2, guardian3]);
      await truffleAssert.reverts(
        manager.relay(
          module,
          "transferOwnership",
          [wallet.address, newowner],
          wallet,
          [owner, guardian1, guardian1],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );
    });

    it("should not allow non guardian signatures", async () => {
      await addGuardians([guardian1]);
      await truffleAssert.reverts(
        manager.relay(
          module,
          "transferOwnership",
          [wallet.address, newowner],
          wallet,
          [owner, nonowner],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );
    });

    describe("Guardians: G = 1", () => {
      beforeEach(async () => {
        await addGuardians([guardian1]);
      });

      testOwnershipTransfer([guardian1]);
    });

    describe("Guardians: G = 2", () => {
      beforeEach(async () => {
        await addGuardians([guardian1, guardian2]);
      });

      testOwnershipTransfer([guardian1, guardian2]);
    });

    describe("Guardians: G = 3", () => {
      beforeEach(async () => {
        await addGuardians([guardian1, guardian2, guardian3]);
      });

      testOwnershipTransfer([guardian1, guardian2, guardian3]);
    });
  });

  describe("benchmark", () => {
    it("should recover wallet with 1 guardian", async () => {
      await addGuardians([guardian1]);

      const txReceipt = await manager.relay(
        module,
        "executeRecovery",
        [wallet.address, newowner],
        wallet,
        [guardian1]);
      const success = await utils.parseRelayReceipt(txReceipt).success;
      assert.isTrue(success, "execute recovery failed");
      console.log("Gas to execute recovery: ", txReceipt.gasUsed);

      await utils.increaseTime(40);

      const tx = await module.finalizeRecovery(wallet.address, { from: infrastructure });
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, newowner, "wallet owner should have been changed");
      console.log("Gas to finalize recovery: ", tx.receipt.gasUsed);
    });
  });
});
