/* global artifacts */
const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const BN = require("bn.js");
const { formatBytes32String } = require("ethers").utils;
const utils = require("../utils/utilities.js");
const { ETH_TOKEN } = require("../utils/utilities.js");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const BadFeature = artifacts.require("BadFeature");
const RelayerManager = artifacts.require("RelayerManager");
const TestFeature = artifacts.require("TestFeature");
const TestLimitFeature = artifacts.require("TestLimitFeature");
const Registry = artifacts.require("ModuleRegistry");
const GuardianManager = artifacts.require("GuardianManager");
const GuardianStorage = artifacts.require("GuardianStorage");
const LockStorage = artifacts.require("LockStorage");
const LimitStorage = artifacts.require("LimitStorage");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const ApprovedTransfer = artifacts.require("ApprovedTransfer");
const RecoveryManager = artifacts.require("RecoveryManager"); // non-owner only feature
const VersionManager = artifacts.require("VersionManager");
const ERC20 = artifacts.require("TestERC20");

const RelayManager = require("../utils/relay-manager");

contract("RelayerManager", (accounts) => {
  const manager = new RelayManager();

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const recipient = accounts[3];
  const guardian = accounts[4];

  let registry;
  let guardianStorage;
  let lockStorage;
  let limitStorage;
  let guardianManager;
  let recoveryManager;
  let wallet;
  let approvedTransfer;
  let testFeature;
  let testFeatureNew;
  let relayerManager;
  let tokenPriceRegistry;
  let limitFeature;
  let badFeature;
  let versionManager;
  let versionManagerV2;

  before(async () => {
    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    lockStorage = await LockStorage.new();
    limitStorage = await LimitStorage.new();
    versionManager = await VersionManager.new(
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      limitStorage.address);
    versionManagerV2 = await VersionManager.new(
      registry.address,
      lockStorage.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      limitStorage.address);

    tokenPriceRegistry = await TokenPriceRegistry.new();
    await tokenPriceRegistry.addManager(infrastructure);
    relayerManager = await RelayerManager.new(
      lockStorage.address,
      guardianStorage.address,
      limitStorage.address,
      tokenPriceRegistry.address,
      versionManager.address);
    manager.setRelayerManager(relayerManager);
  });

  beforeEach(async () => {
    approvedTransfer = await ApprovedTransfer.new(
      lockStorage.address,
      guardianStorage.address,
      limitStorage.address,
      versionManager.address,
      ethers.constants.AddressZero);
    guardianManager = await GuardianManager.new(
      lockStorage.address,
      guardianStorage.address,
      versionManager.address,
      24,
      12);
    recoveryManager = await RecoveryManager.new(
      lockStorage.address,
      guardianStorage.address,
      versionManager.address,
      36, 24 * 5);

    testFeature = await TestFeature.new(lockStorage.address, versionManager.address, 0);
    testFeatureNew = await TestFeature.new(lockStorage.address, versionManager.address, 0);

    limitFeature = await TestLimitFeature.new(
      lockStorage.address, limitStorage.address, versionManager.address);
    badFeature = await BadFeature.new(lockStorage.address, versionManager.address);

    const walletImplementation = await BaseWallet.new();
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);

    for (const vm of [versionManager, versionManagerV2]) {
      await vm.addVersion([
        relayerManager.address,
        approvedTransfer.address,
        guardianManager.address,
        recoveryManager.address,
        testFeature.address,
        limitFeature.address,
        badFeature.address,
      ], []);
    }

    await wallet.init(owner, [versionManager.address]);
    await versionManager.upgradeWallet(wallet.address, await versionManager.lastVersion(), { from: owner });
  });

  describe("relaying feature transactions", () => {
    it("should fail when _data is less than 36 bytes", async () => {
      const params = []; // the first argument is not the wallet address, which should make the relaying revert
      await truffleAssert.reverts(
        manager.relay(testFeature, "clearInt", params, wallet, [owner]), "RM: Invalid dataWallet",
      );
    });

    it("should fail when feature is not authorised", async () => {
      const params = [wallet.address, 2];
      await truffleAssert.reverts(
        manager.relay(testFeatureNew, "setIntOwnerOnly", params, wallet, [owner]), "RM: feature not authorised",
      );
    });

    it("should fail when the RelayerManager is not authorised", async () => {
      await versionManager.addVersion([testFeature.address], []);
      const wrongWallet = await BaseWallet.new();
      await wrongWallet.init(owner, [versionManager.address]);
      await versionManager.upgradeWallet(wrongWallet.address, await versionManager.lastVersion(), { from: owner });
      const params = [wrongWallet.address, 2];
      const txReceipt = await manager.relay(testFeature, "setIntOwnerOnly", params, wrongWallet, [owner]);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isFalse(success);
      assert.equal(error, "BF: must be owner or feature");

      // reset last version to default bundle
      await versionManager.addVersion([
        relayerManager.address,
        approvedTransfer.address,
        guardianManager.address,
        recoveryManager.address,
        testFeature.address,
        limitFeature.address,
        badFeature.address,
      ], []);
    });

    it("should fail when the first param is not the wallet ", async () => {
      const params = [owner, 4];
      await truffleAssert.reverts(
        manager.relay(testFeature, "setIntOwnerOnly", params, wallet, [owner]), "RM: Target of _data != _wallet",
      );
    });

    it("should fail when the gas of the transaction is less then the gasLimit", async () => {
      const params = [wallet.address, 2];
      const nonce = await utils.getNonceForRelay();
      const gasLimit = 2000000;
      const relayParams = [
        testFeature,
        "setIntOwnerOnly",
        params,
        wallet,
        [owner],
        gasLimit,
        nonce,
        0,
        ETH_TOKEN,
        ethers.constants.AddressZero,
        gasLimit * 0.9];

      await truffleAssert.reverts(manager.relay(...relayParams), "RM: not enough gas provided");
    });

    it("should fail when a wrong number of signatures is provided", async () => {
      const params = [wallet.address, 2];
      const relayParams = [testFeature, "setIntOwnerOnly", params, wallet, [owner, recipient]];
      await truffleAssert.reverts(manager.relay(...relayParams), "RM: Wrong number of signatures");
    });

    it("should fail a duplicate transaction", async () => {
      const params = [wallet.address, 2];
      const nonce = await utils.getNonceForRelay();
      const relayParams = [testFeature, "setIntOwnerOnly", params, wallet, [owner], 2000000, nonce];
      await manager.relay(...relayParams);
      await truffleAssert.reverts(
        manager.relay(...relayParams), "RM: Duplicate request",
      );
    });

    it("should fail when relaying to itself", async () => {
      const dataMethod = "setIntOwnerOnly";
      const dataParam = [wallet.address, 2];
      const methodData = testFeature.contract.methods[dataMethod](...dataParam).encodeABI();
      const params = [
        wallet.address,
        testFeature.address,
        methodData,
        0,
        ethers.constants.HashZero,
        0,
        200000,
        ETH_TOKEN,
        ethers.constants.AddressZero,
      ];
      await truffleAssert.reverts(
        manager.relay(relayerManager, "execute", params, wallet, [owner]), "BF: disabled method",
      );
    });

    it("should update the nonce after the transaction", async () => {
      const nonce = await utils.getNonceForRelay();
      await manager.relay(testFeature, "setIntOwnerOnly", [wallet.address, 2], wallet, [owner], 2000000, nonce);

      const updatedNonce = await relayerManager.getNonce(wallet.address);
      const updatedNonceHex = await updatedNonce.toString(16, 32);
      assert.equal(nonce, `0x${updatedNonceHex}`);
    });
  });

  describe("refund relayed transactions", () => {
    let erc20;
    beforeEach(async () => {
      const decimals = 12; // number of decimal for TOKN contract
      const tokenRate = new BN(10).pow(new BN(19)).mul(new BN(51)); // 1 TOKN = 0.00051 ETH = 0.00051*10^18 ETH wei => *10^(18-decimals) = 0.00051*10^18 * 10^6 = 0.00051*10^24 = 51*10^19
      erc20 = await ERC20.new([infrastructure], 10000000, decimals); // TOKN contract with 10M tokens (10M TOKN for account[0])
      await tokenPriceRegistry.setPriceForTokenList([erc20.address], [tokenRate]);
      await limitFeature.setLimitAndDailySpent(wallet.address, 10000000000, 0);
    });

    async function provisionFunds(ethAmount, erc20Amount) {
      if (ethAmount) {
        await wallet.send(ethAmount);
      }
      if (erc20Amount) {
        await erc20.transfer(wallet.address, erc20Amount);
      }
    }

    async function callAndRefund({ refundToken }) {
      const nonce = await utils.getNonceForRelay();
      const relayParams = [
        testFeature,
        "setIntOwnerOnly",
        [wallet.address, 2],
        wallet,
        [owner],
        2000000,
        nonce,
        10,
        refundToken,
        recipient];
      const txReceipt = await manager.relay(...relayParams);
      return txReceipt;
    }

    async function setLimitAndDailySpent({ limit, alreadySpent }) {
      await limitFeature.setLimitAndDailySpent(wallet.address, limit, alreadySpent);
    }

    it("should refund in ETH", async () => {
      await provisionFunds("100000000000000", 0);
      const wBalanceStart = await utils.getBalance(wallet.address);
      const rBalanceStart = await utils.getBalance(recipient);
      await callAndRefund({ refundToken: ETH_TOKEN });
      const wBalanceEnd = await utils.getBalance(wallet.address);
      const rBalanceEnd = await utils.getBalance(recipient);
      const refund = wBalanceStart.sub(wBalanceEnd);
      assert.isTrue(refund.gt(0), "should have refunded ETH");
      assert.isTrue(refund.eq(rBalanceEnd.sub(rBalanceStart)), "should have refunded the recipient");
    });

    it("should refund in ERC20", async () => {
      await provisionFunds(0, "100000000000000");
      const wBalanceStart = await erc20.balanceOf(wallet.address);
      const rBalanceStart = await erc20.balanceOf(recipient);
      await callAndRefund({ refundToken: erc20.address });
      const wBalanceEnd = await erc20.balanceOf(wallet.address);
      const rBalanceEnd = await erc20.balanceOf(recipient);
      const refund = wBalanceStart.sub(wBalanceEnd);
      assert.isTrue(refund.gt(0), "should have refunded ERC20");
      assert.isTrue(refund.eq(rBalanceEnd.sub(rBalanceStart)), "should have refunded the recipient");
    });

    it("should emit the Refund event", async () => {
      await provisionFunds("100000000000", 0);
      const txReceipt = await callAndRefund({ refundToken: ETH_TOKEN });
      await utils.hasEvent(txReceipt, relayerManager, "Refund");
    });

    it("should fail the transaction when there is not enough ETH for the refund", async () => {
      await provisionFunds(10, 0);
      await truffleAssert.reverts(callAndRefund({ refundToken: ETH_TOKEN }), "VM: wallet invoke reverted");
    });

    it("should fail the transaction when there is not enough ERC20 for the refund", async () => {
      await provisionFunds(0, 10);
      await truffleAssert.reverts(callAndRefund({ refundToken: erc20.address }), "ERC20: transfer amount exceeds balance");
    });

    it("should include the refund in the daily limit", async () => {
      await provisionFunds("100000000000", 0);
      await setLimitAndDailySpent({ limit: 1000000000, alreadySpent: 10 });
      let dailySpent = await limitFeature.getDailySpent(wallet.address);
      assert.isTrue(dailySpent.toNumber() === 10, "initial daily spent should be 10");
      await callAndRefund({ refundToken: ETH_TOKEN });
      dailySpent = await limitFeature.getDailySpent(wallet.address);
      assert.isTrue(dailySpent > 10, "Daily spent should be greater then 10");
    });

    it("should refund and reset the daily limit when approved by guardians", async () => {
      // set funds and limit/daily spent
      await provisionFunds("100000000000", 0);
      await setLimitAndDailySpent({ limit: 1000000000, alreadySpent: 10 });
      let dailySpent = await limitFeature.getDailySpent(wallet.address);
      assert.isTrue(dailySpent.toNumber() === 10, "initial daily spent should be 10");
      const rBalanceStart = await utils.getBalance(recipient);
      // add a guardian
      await guardianManager.addGuardian(wallet.address, guardian, { from: owner });
      // call approvedTransfer
      const params = [wallet.address, ETH_TOKEN, recipient, 1000, ethers.constants.HashZero];
      const nonce = await utils.getNonceForRelay();
      const gasLimit = 2000000;
      const relayParams = [
        approvedTransfer,
        "transferToken",
        params,
        wallet,
        [owner, guardian],
        gasLimit,
        nonce,
        0,
        ETH_TOKEN,
        ethers.constants.AddressZero,
        gasLimit * 1.1];
      await manager.relay(...relayParams);
      dailySpent = await limitFeature.getDailySpent(wallet.address);
      assert.isTrue(dailySpent.toNumber() === 0, "daily spent should be reset");
      const rBalanceEnd = await utils.getBalance(recipient);
      assert.isTrue(rBalanceEnd.gt(rBalanceStart), "should have refunded the recipient");
    });

    it("should fail if required signatures is 0 and OwnerRequirement is not Anyone", async () => {
      await truffleAssert.reverts(
        manager.relay(badFeature, "setIntOwnerOnly", [wallet.address, 2], wallet, [owner]), "RM: Wrong signature requirement",
      );
    });

    it("should fail the transaction when the refund is over the daily limit", async () => {
      await provisionFunds("100000000000", 0);
      await setLimitAndDailySpent({ limit: 1000000000, alreadySpent: 999999990 });
      const dailySpent = await limitFeature.getDailySpent(wallet.address);
      assert.isTrue(dailySpent.toNumber() === 999999990, "initial daily spent should be 999999990");
      await truffleAssert.reverts(callAndRefund({ refundToken: ETH_TOKEN }), "RM: refund is above daily limit");
    });
  });

  describe("addModule transactions", () => {
    it("should succeed when relayed on VersionManager", async () => {
      await registry.registerModule(versionManagerV2.address, formatBytes32String("versionManagerV2"));
      const params = [wallet.address, versionManagerV2.address];
      await manager.relay(versionManager, "addModule", params, wallet, [owner]);

      const isModuleAuthorised = await wallet.authorised(versionManagerV2.address);
      assert.isTrue(isModuleAuthorised);
      await registry.deregisterModule(versionManagerV2.address);
    });

    it("should succeed when called directly on VersionManager", async () => {
      await registry.registerModule(versionManagerV2.address, formatBytes32String("versionManagerV2"));
      await versionManager.addModule(wallet.address, versionManagerV2.address, { from: owner });

      const isModuleAuthorised = await wallet.authorised(versionManagerV2.address);
      assert.isTrue(isModuleAuthorised);
      await registry.deregisterModule(versionManagerV2.address);
    });

    it("should fail to add module which is not registered", async () => {
      await truffleAssert.reverts(versionManager.addModule(wallet.address, versionManagerV2.address, { from: owner }),
        "VM: module is not registered");
    });
  });
});
