/* global artifacts */
const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const BN = require("bn.js");

const GuardianManager = artifacts.require("GuardianManager");
const LockManager = artifacts.require("LockManager");
const RecoveryManager = artifacts.require("RecoveryManager");
const GuardianStorage = artifacts.require("GuardianStorage");
const LockStorage = artifacts.require("LockStorage");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const RelayerManager = artifacts.require("RelayerManager");
const VersionManager = artifacts.require("VersionManager");

const RelayManager = require("../utils/relay-manager");
const utils = require("../utils/utilities.js");

const WRONG_SIGNATURE_NUMBER_REVERT_MSG = "RM: Wrong number of signatures";
const INVALID_SIGNATURES_REVERT_MSG = "RM: Invalid signatures";

contract("RecoveryManager", (accounts) => {
  const manager = new RelayManager();

  const owner = accounts[1];
  const guardian1 = accounts[2];
  const guardian2 = accounts[3];
  const guardian3 = accounts[4];
  const newowner = accounts[5];
  const nonowner = accounts[6];
  const nonowner2 = accounts[9];

  let guardianManager;
  let lockStorage;
  let guardianStorage;
  let lockManager;
  let recoveryManager;
  let recoveryPeriod;
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
    recoveryPeriod = await recoveryManager.recoveryPeriod();
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

  async function addGuardians(guardians) {
    // guardians can be BaseWallet or ContractWrapper objects
    for (const guardian of guardians) {
      await guardianManager.addGuardian(wallet.address, guardian, { from: owner });
    }

    await utils.increaseTime(30);
    for (let i = 1; i < guardians.length; i += 1) {
      await guardianManager.confirmGuardianAddition(wallet.address, guardians[i]);
    }
    const count = (await guardianManager.guardianCount(wallet.address)).toNumber();
    assert.equal(count, guardians.length, `${guardians.length} guardians should be added`);
  }

  async function createSmartContractGuardians(guardians) {
    const wallets = [];
    let guardian;
    for (guardian of guardians) {
      const proxy = await Proxy.new(walletImplementation.address);
      const guardianWallet = await BaseWallet.at(proxy.address);
      await guardianWallet.init(guardian, [versionManager.address]);
      await versionManager.upgradeWallet(guardianWallet.address, await versionManager.lastVersion(), { from: guardian });
      wallets.push(guardianWallet.address);
    }
    return wallets;
  }

  function testExecuteRecovery(guardians) {
    it("should let a majority of guardians execute the recovery procedure", async () => {
      const majority = guardians.slice(0, Math.ceil((guardians.length) / 2));
      await manager.relay(recoveryManager, "executeRecovery", [wallet.address, newowner], wallet, utils.sortWalletByAddress(majority));
      const timestamp = await utils.getTimestamp();
      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isTrue(isLocked, "should be locked by recovery");

      const recoveryConfig = await recoveryManager.getRecovery(wallet.address);
      assert.equal(recoveryConfig._address, newowner);
      assert.closeTo(recoveryConfig._executeAfter.toNumber(), recoveryPeriod.add(new BN(timestamp)).toNumber(), 1);
      assert.equal(recoveryConfig._guardianCount, guardians.length);
    });

    it("should not let owner execute the recovery procedure", async () => {
      const expectedRevertMsg = guardians.length >= 3 ? WRONG_SIGNATURE_NUMBER_REVERT_MSG : INVALID_SIGNATURES_REVERT_MSG;
      await truffleAssert.reverts(
        manager.relay(
          recoveryManager,
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
          recoveryManager,
          "executeRecovery",
          [wallet.address, newowner],
          wallet,
          [owner, ...utils.sortWalletByAddress(majority)],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );

      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isFalse(isLocked, "should not be locked");
    });

    it("should not let a minority of guardians execute the recovery procedure", async () => {
      const minority = guardians.slice(0, Math.ceil((guardians.length) / 2) - 1);
      await truffleAssert.reverts(
        manager.relay(
          recoveryManager,
          "executeRecovery",
          [wallet.address, newowner],
          wallet,
          utils.sortWalletByAddress(minority),
        ), WRONG_SIGNATURE_NUMBER_REVERT_MSG,
      );

      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isFalse(isLocked, "should not be locked");
    });
  }

  function testFinalizeRecovery() {
    it("should let anyone finalize the recovery procedure after the recovery period", async () => {
      await utils.increaseTime(40); // moving time to after the end of the recovery period
      await manager.relay(recoveryManager, "finalizeRecovery", [wallet.address], wallet, []);
      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isFalse(isLocked, "should no longer be locked after finalization of recovery");
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, newowner, "wallet owner should have been changed");

      const recoveryConfig = await recoveryManager.getRecovery(wallet.address);
      assert.equal(recoveryConfig._address, ethers.constants.AddressZero);
      assert.equal(recoveryConfig._executeAfter.toNumber(), 0);
      assert.equal(recoveryConfig._guardianCount, 0);
    });

    it("should not let anyone finalize the recovery procedure before the end of the recovery period", async () => {
      const txReceipt = await manager.relay(recoveryManager, "finalizeRecovery", [wallet.address], wallet, []);
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, "RM: the recovery period is not over yet");

      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isTrue(isLocked, "should still be locked");
    });
  }

  function testCancelRecovery() {
    it("should let 2 guardians cancel the recovery procedure", async () => {
      await manager.relay(recoveryManager, "cancelRecovery", [wallet.address], wallet, utils.sortWalletByAddress([guardian1, guardian2]));
      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isFalse(isLocked, "should no longer be locked by recovery");
      await utils.increaseTime(40); // moving time to after the end of the recovery period
      const txReceipt = await manager.relay(recoveryManager, "finalizeRecovery", [wallet.address], wallet, []);
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, "RM: there must be an ongoing recovery");
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "wallet owner should not have been changed");

      const recoveryConfig = await recoveryManager.getRecovery(wallet.address);
      assert.equal(recoveryConfig._address, ethers.constants.AddressZero);
      assert.equal(recoveryConfig._executeAfter.toNumber(), 0);
      assert.equal(recoveryConfig._guardianCount, 0);
    });

    it("should let 1 guardian + owner cancel the recovery procedure", async () => {
      await manager.relay(recoveryManager, "cancelRecovery", [wallet.address], wallet, [owner, guardian1]);
      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isFalse(isLocked, "should no longer be locked by recovery");
      await utils.increaseTime(40); // moving time to after the end of the recovery period
      const txReceipt = await manager.relay(recoveryManager, "finalizeRecovery", [wallet.address], wallet, []);
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "finalization should have failed");
      assert.equal(error, "RM: there must be an ongoing recovery");
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "wallet owner should not have been changed");
    });

    it("should not let 1 guardian cancel the recovery procedure", async () => {
      await truffleAssert.reverts(
        manager.relay(
          recoveryManager,
          "cancelRecovery",
          [wallet.address],
          wallet,
          [guardian1],
        ), WRONG_SIGNATURE_NUMBER_REVERT_MSG,
      );

      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isTrue(isLocked, "should still be locked");
    });

    it("should not let the owner cancel the recovery procedure", async () => {
      await truffleAssert.reverts(
        manager.relay(
          recoveryManager,
          "cancelRecovery",
          [wallet.address],
          wallet,
          [owner],
        ), WRONG_SIGNATURE_NUMBER_REVERT_MSG,
      );

      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isTrue(isLocked, "should still be locked");
    });

    it("should not allow duplicate guardian signatures", async () => {
      await truffleAssert.reverts(
        manager.relay(
          recoveryManager,
          "cancelRecovery",
          [wallet.address],
          wallet,
          [guardian1, guardian1],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );

      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isTrue(isLocked, "should still be locked");
    });

    it("should not allow non guardians signatures", async () => {
      await truffleAssert.reverts(
        manager.relay(
          recoveryManager,
          "cancelRecovery",
          [wallet.address],
          wallet,
          utils.sortWalletByAddress([guardian1, nonowner]),
        ), INVALID_SIGNATURES_REVERT_MSG,
      );

      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isTrue(isLocked, "should still be locked");
    });
  }

  function testOwnershipTransfer(guardians) {
    it("should let owner + the majority of guardians execute an ownership transfer", async () => {
      const majority = guardians.slice(0, Math.ceil((guardians.length) / 2));

      await manager.relay(recoveryManager, "transferOwnership",
        [wallet.address, newowner], wallet, [owner, ...utils.sortWalletByAddress(majority)]);
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, newowner, "owner should have been changed");
    });

    it("should not let owner + minority of guardians execute an ownership transfer", async () => {
      const minority = guardians.slice(0, Math.ceil((guardians.length) / 2) - 1);
      await truffleAssert.reverts(
        manager.relay(
          recoveryManager,
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
          recoveryManager,
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

  describe("RecoveryManager high level logic", () => {
    it("should not be able to instantiate the RecoveryManager with lock period shorter than the recovery period", async () => {
      await truffleAssert.reverts(RecoveryManager.new(
        lockStorage.address,
        guardianStorage.address,
        versionManager.address,
        36, 35),
      "RM: insecure security periods");
    });
  });

  describe("Execute Recovery", () => {
    it("should not allow recovery to be executed with no guardians", async () => {
      const noGuardians = [];
      await truffleAssert.reverts(manager.relay(
        recoveryManager,
        "executeRecovery",
        [wallet.address, newowner],
        wallet,
        noGuardians,
      ), "RM: no guardians set on wallet");

      const isLocked = await lockManager.isLocked(wallet.address);
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
            recoveryManager,
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

      it("should not be able to call ExecuteRecovery with an empty recovery address", async () => {
        const txReceipt = await manager.relay(recoveryManager, "executeRecovery",
          [wallet.address, ethers.constants.AddressZero], wallet, [guardian1]);
        const { success, error } = utils.parseRelayReceipt(txReceipt);
        assert.isFalse(success, "executeRecovery should fail");
        assert.equal(error, "RM: new owner address cannot be null");
      });

      it("should not be able to call ExecuteRecovery with a guardian address", async () => {
        const txReceipt = await manager.relay(recoveryManager, "executeRecovery",
          [wallet.address, guardian1], wallet, [guardian1]);
        const { success, error } = utils.parseRelayReceipt(txReceipt);
        assert.isFalse(success, "executeRecovery should fail");
        assert.equal(error, "RM: new owner address cannot be a guardian");
      });

      it("should not be able to call ExecuteRecovery if already in the process of Recovery", async () => {
        await manager.relay(recoveryManager, "executeRecovery",
          [wallet.address, newowner], wallet, utils.sortWalletByAddress([guardian1]));

        const txReceipt = await manager.relay(recoveryManager, "executeRecovery",
          [wallet.address, ethers.constants.AddressZero], wallet, [guardian1]);
        const { success, error } = utils.parseRelayReceipt(txReceipt);
        assert.isFalse(success, "executeRecovery should fail");
        assert.equal(error, "RM: there cannot be an ongoing recovery");
      });

      it("should revert if an unknown method is executed", async () => {
        const nonce = await utils.getNonceForRelay();
        const chainId = await utils.getChainId();
        let methodData = recoveryManager.contract.methods.executeRecovery(wallet.address, ethers.constants.AddressZero).encodeABI();
        // Replace the `executeRecovery` method signature: b0ba4da0 with a non-existent one: e0b6fcfc
        methodData = methodData.replace("b0ba4da0", "e0b6fcfc");

        const signatures = await utils.signOffchain(
          [guardian1],
          relayerManager.address,
          recoveryManager.address,
          0,
          methodData,
          chainId,
          nonce,
          0,
          700000,
          utils.ETH_TOKEN,
          ethers.constants.AddressZero,
        );
        await truffleAssert.reverts(
          relayerManager.execute(
            wallet.address,
            recoveryManager.address,
            methodData,
            nonce,
            signatures,
            0,
            700000,
            utils.ETH_TOKEN,
            ethers.constants.AddressZero,
            { gasLimit: 800000, from: nonowner2 },
          ),
          "RM: unknown method",
        );
      });
    });
  });

  describe("Finalize Recovery", () => {
    beforeEach(async () => {
      await addGuardians([guardian1, guardian2, guardian3]);
      await manager.relay(
        recoveryManager,
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
          recoveryManager,
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
          recoveryManager,
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
        recoveryManager,
        "transferOwnership",
        [wallet.address, ethers.constants.AddressZero], wallet, [owner, guardian1],
      );
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "transferOwnership should fail");
      assert.equal(error, "RM: new owner address cannot be null");
    });

    it("should not allow transfer to a guardian address", async () => {
      await addGuardians([guardian1]);
      const txReceipt = await manager.relay(
        recoveryManager,
        "transferOwnership",
        [wallet.address, guardian1], wallet, [owner, guardian1],
      );
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "transferOwnership should fail");
      assert.equal(error, "RM: new owner address cannot be a guardian");
    });

    it("when no guardians, owner should be able to transfer alone", async () => {
      const txReceipt = await manager.relay(
        recoveryManager,
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
          recoveryManager,
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
          recoveryManager,
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
          recoveryManager,
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
          recoveryManager,
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
});
