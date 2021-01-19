/* global artifacts */
const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const BN = require("bn.js");

const RelayManager = require("../utils/relay-manager");
const utils = require("../utils/utilities.js");
const { setupWalletVersion } = require("../utils/wallet_definition.js");

const WRONG_SIGNATURE_NUMBER_REVERT_MSG = "RM: Wrong number of signatures";
const INVALID_SIGNATURES_REVERT_MSG = "RM: Invalid signatures";

contract.skip("RecoveryManager", (accounts) => {
  const manager = new RelayManager();

  const owner = accounts[1];
  const guardian1 = accounts[2];
  const guardian2 = accounts[3];
  const guardian3 = accounts[4];
  const newowner = accounts[5];
  const nonowner = accounts[6];
  const nonowner2 = accounts[9];

  let recoveryPeriod;
  let wallet;
  let relayerManager;

  before(async () => {
    const modules = await setupWalletVersion({ tokenPriceRegistry: tokenPriceRegistry.address });
    registry = modules.registry;
    relayerManager = modules.relayerManager;

    await manager.setRelayerManager(relayerManager);
  });

  beforeEach(async () => {
    const proxy = await DelegateProxy.new({ from: owner });
    await proxy.setRegistry(registry.address, { from: owner });
    wallet = await IWallet.at(proxy.address);
  });

  async function addGuardians(guardians) {
    // guardians can be BaseWallet or ContractWrapper objects
    for (const guardian of guardians) {
      await wallet.addGuardian(guardian, { from: owner });
    }

    await utils.increaseTime(30);
    for (let i = 1; i < guardians.length; i += 1) {
      await wallet.confirmGuardianAddition(guardians[i]);
    }
    const count = (await wallet.guardianCount()).toNumber();
    assert.equal(count, guardians.length, `${guardians.length} guardians should be added`);
  }

  async function createSmartContractGuardians(guardians) {
    const wallets = [];
    let guardian;
    for (guardian of guardians) {
      const proxy = await DelegateProxy.new({ from: guardian });
      await proxy.setRegistry(registry.address, { from: guardian });
      const guardianWallet = await IWallet.at(proxy.address);

      wallets.push(guardianWallet.address);
    }
    return wallets;
  }

  function testExecuteRecovery(guardians) {
    it("should let a majority of guardians execute the recovery procedure", async () => {
      const majority = guardians.slice(0, Math.ceil((guardians.length) / 2));
      await manager.relay(wallet, "executeRecovery", [newowner], utils.sortWalletByAddress(majority));
      const timestamp = await utils.getTimestamp();
      const isLocked = await wallet.isLocked();
      assert.isTrue(isLocked, "should be locked by recovery");

      const recoveryConfig = await wallet.getRecovery();
      assert.equal(recoveryConfig._address, newowner);
      assert.closeTo(recoveryConfig._executeAfter.toNumber(), recoveryPeriod.add(new BN(timestamp)).toNumber(), 1);
      assert.equal(recoveryConfig._guardianCount, guardians.length);
    });

    it("should not let owner execute the recovery procedure", async () => {
      const expectedRevertMsg = guardians.length >= 3 ? WRONG_SIGNATURE_NUMBER_REVERT_MSG : INVALID_SIGNATURES_REVERT_MSG;
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "executeRecovery",
          [newowner],
          [owner],
        ), expectedRevertMsg,
      );
    });

    it("should not let a majority of guardians and owner execute the recovery procedure", async () => {
      const majority = guardians.slice(0, Math.ceil((guardians.length) / 2) - 1);
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "executeRecovery",
          [newowner],
          [owner, ...utils.sortWalletByAddress(majority)],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );

      const isLocked = await wallet.isLocked();
      assert.isFalse(isLocked, "should not be locked");
    });

    it("should not let a minority of guardians execute the recovery procedure", async () => {
      const minority = guardians.slice(0, Math.ceil((guardians.length) / 2) - 1);
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "executeRecovery",
          [newowner],
          utils.sortWalletByAddress(minority),
        ), WRONG_SIGNATURE_NUMBER_REVERT_MSG,
      );

      const isLocked = await wallet.isLocked();
      assert.isFalse(isLocked, "should not be locked");
    });
  }

  function testFinalizeRecovery() {
    it("should let anyone finalize the recovery procedure after the recovery period", async () => {
      await utils.increaseTime(40); // moving time to after the end of the recovery period
      await manager.relay(wallet, "finalizeRecovery", [], []);
      const isLocked = await wallet.isLocked();
      assert.isFalse(isLocked, "should no longer be locked after finalization of recovery");
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, newowner, "wallet owner should have been changed");

      const recoveryConfig = await wallet.getRecovery();
      assert.equal(recoveryConfig._address, ethers.constants.AddressZero);
      assert.equal(recoveryConfig._executeAfter.toNumber(), 0);
      assert.equal(recoveryConfig._guardianCount, 0);
    });

    it("should not let anyone finalize the recovery procedure before the end of the recovery period", async () => {
      const txReceipt = await manager.relay(wallet, "finalizeRecovery", [], []);
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, "RM: the recovery period is not over yet");

      const isLocked = await wallet.isLocked();
      assert.isTrue(isLocked, "should still be locked");
    });
  }

  function testCancelRecovery() {
    it("should let 2 guardians cancel the recovery procedure", async () => {
      await manager.relay(wallet, "cancelRecovery", [], utils.sortWalletByAddress([guardian1, guardian2]));
      const isLocked = await wallet.isLocked();
      assert.isFalse(isLocked, "should no longer be locked by recovery");
      await utils.increaseTime(40); // moving time to after the end of the recovery period
      const txReceipt = await manager.relay(wallet, "finalizeRecovery", [], []);
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, "RM: there must be an ongoing recovery");
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "wallet owner should not have been changed");

      const recoveryConfig = await wallet.getRecovery();
      assert.equal(recoveryConfig._address, ethers.constants.AddressZero);
      assert.equal(recoveryConfig._executeAfter.toNumber(), 0);
      assert.equal(recoveryConfig._guardianCount, 0);
    });

    it("should let 1 guardian + owner cancel the recovery procedure", async () => {
      await manager.relay(wallet, "cancelRecovery", [], [owner, guardian1]);
      const isLocked = await wallet.isLocked();
      assert.isFalse(isLocked, "should no longer be locked by recovery");
      await utils.increaseTime(40); // moving time to after the end of the recovery period
      const txReceipt = await manager.relay(wallet, "finalizeRecovery", [], []);
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "finalization should have failed");
      assert.equal(error, "RM: there must be an ongoing recovery");
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, owner, "wallet owner should not have been changed");
    });

    it("should not let 1 guardian cancel the recovery procedure", async () => {
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "cancelRecovery",
          [],
          [guardian1],
        ), WRONG_SIGNATURE_NUMBER_REVERT_MSG,
      );

      const isLocked = await wallet.isLocked();
      assert.isTrue(isLocked, "should still be locked");
    });

    it("should not let the owner cancel the recovery procedure", async () => {
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "cancelRecovery",
          [],
          [owner],
        ), WRONG_SIGNATURE_NUMBER_REVERT_MSG,
      );

      const isLocked = await wallet.isLocked();
      assert.isTrue(isLocked, "should still be locked");
    });

    it("should not allow duplicate guardian signatures", async () => {
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "cancelRecovery",
          [],
          [guardian1, guardian1],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );

      const isLocked = await wallet.isLocked();
      assert.isTrue(isLocked, "should still be locked");
    });

    it("should not allow non guardians signatures", async () => {
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "cancelRecovery",
          [],
          utils.sortWalletByAddress([guardian1, nonowner]),
        ), INVALID_SIGNATURES_REVERT_MSG,
      );

      const isLocked = await wallet.isLocked();
      assert.isTrue(isLocked, "should still be locked");
    });
  }

  function testOwnershipTransfer(guardians) {
    it("should let owner + the majority of guardians execute an ownership transfer", async () => {
      const majority = guardians.slice(0, Math.ceil((guardians.length) / 2));

      await manager.relay(wallet, "transferOwnership",
        [newowner], [owner, ...utils.sortWalletByAddress(majority)]);
      const walletOwner = await wallet.owner();
      assert.equal(walletOwner, newowner, "owner should have been changed");
    });

    it("should not let owner + minority of guardians execute an ownership transfer", async () => {
      const minority = guardians.slice(0, Math.ceil((guardians.length) / 2) - 1);
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "transferOwnership",
          [newowner],
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
          wallet,
          "transferOwnership",
          [newowner],
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
        wallet,
        "executeRecovery",
        [newowner],
        wallet,
        noGuardians,
      ), "RM: no guardians set on wallet");

      const isLocked = await wallet.isLocked();
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
            wallet,
            "executeRecovery",
            [newowner],
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
        const txReceipt = await manager.relay(wallet, "executeRecovery", [ethers.constants.AddressZero], [guardian1]);
        const { success, error } = utils.parseRelayReceipt(txReceipt);
        assert.isFalse(success, "executeRecovery should fail");
        assert.equal(error, "RM: new owner address cannot be null");
      });

      it("should not be able to call ExecuteRecovery with a guardian address", async () => {
        const txReceipt = await manager.relay(wallet, "executeRecovery", [guardian1], [guardian1]);
        const { success, error } = utils.parseRelayReceipt(txReceipt);
        assert.isFalse(success, "executeRecovery should fail");
        assert.equal(error, "RM: new owner address cannot be a guardian");
      });

      it("should not be able to call ExecuteRecovery if already in the process of Recovery", async () => {
        await manager.relay(wallet, "executeRecovery", [newowner], utils.sortWalletByAddress([guardian1]));

        const txReceipt = await manager.relay(wallet, "executeRecovery", [ethers.constants.AddressZero], [guardian1]);
        const { success, error } = utils.parseRelayReceipt(txReceipt);
        assert.isFalse(success, "executeRecovery should fail");
        assert.equal(error, "RM: there cannot be an ongoing recovery");
      });

      it("should revert if an unknown method is executed", async () => {
        const nonce = await utils.getNonceForRelay();
        const chainId = await utils.getChainId();
        let methodData = wallet.contract.methods.executeRecovery(ethers.constants.AddressZero).encodeABI();
        // Replace the `executeRecovery` method signature: b0ba4da0 with a non-existent one: e0b6fcfc
        methodData = methodData.replace("b0ba4da0", "e0b6fcfc");

        const signatures = await utils.signOffchain(
          [guardian1],
          wallet.address,
          wallet.address,
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
            wallet.address,
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
        wallet,
        "executeRecovery",
        [newowner],
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
          wallet,
          "executeRecovery",
          [newowner],
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
          wallet,
          "executeRecovery",
          [newowner],
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
        wallet,
        "transferOwnership",
        [ethers.constants.AddressZero], [owner, guardian1],
      );
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "transferOwnership should fail");
      assert.equal(error, "RM: new owner address cannot be null");
    });

    it("should not allow transfer to a guardian address", async () => {
      await addGuardians([guardian1]);
      const txReceipt = await manager.relay(
        wallet,
        "transferOwnership",
        [guardian1], [owner, guardian1],
      );
      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success, "transferOwnership should fail");
      assert.equal(error, "RM: new owner address cannot be a guardian");
    });

    it("when no guardians, owner should be able to transfer alone", async () => {
      const txReceipt = await manager.relay(
        wallet,
        "transferOwnership",
        [newowner],
        [owner],
      );
      const { success } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, "transferOwnership should succeed");
    });

    it("should not allow owner not signing", async () => {
      await addGuardians([guardian1]);
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "transferOwnership",
          [newowner],
          [nonowner, guardian1],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );
    });

    it("should not allow duplicate owner signatures", async () => {
      await addGuardians([guardian1]);
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "transferOwnership",
          [newowner],
          [owner, owner],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );
    });

    it("should not allow duplicate guardian signatures", async () => {
      await addGuardians([guardian1, guardian2, guardian3]);
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "transferOwnership",
          [newowner],
          [owner, guardian1, guardian1],
        ), INVALID_SIGNATURES_REVERT_MSG,
      );
    });

    it("should not allow non guardian signatures", async () => {
      await addGuardians([guardian1]);
      await truffleAssert.reverts(
        manager.relay(
          wallet,
          "transferOwnership",
          [newowner],
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
