/* global artifacts */
const truffleAssert = require("truffle-assertions");
const ethers = require("ethers");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");
const utils = require("../utils/utilities.js");
const { ETH_TOKEN } = require("../utils/utilities.js");

const { expect } = chai;
chai.use(bnChai(BN));

const IWallet = artifacts.require("IWallet");
const DelegateProxy = artifacts.require("DelegateProxy");
const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
//const BadFeature = artifacts.require("BadFeature");
//const TestFeature = artifacts.require("TestFeature");
const ERC20 = artifacts.require("TestERC20");

const RelayManager = require("../utils/relay-manager");
const { setupWalletVersion } = require("../utils/wallet_definition.js");

contract("RelayerManager", (accounts) => {
  const manager = new RelayManager();

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const recipient = accounts[3];
  const guardian = accounts[4];

  let registry;
  let lockStorage;
  let wallet;
  let testFeature;
  let testFeatureNew;
  let relayerManager;
  let tokenPriceRegistry;
  let badFeature;

  before(async () => {
    tokenPriceRegistry = await TokenPriceRegistry.new();
    await tokenPriceRegistry.addManager(infrastructure);

    const modules = await setupWalletVersion({ tokenPriceRegistry: tokenPriceRegistry.address });
    registry = modules.registry;
    relayerManager = modules.relayerManager;

    await manager.setRelayerManager(relayerManager);
  });

  beforeEach(async () => {
    const proxy = await DelegateProxy.new({ from: owner });
    await proxy.setRegistry(registry.address, { from: owner });
    wallet = await IWallet.at(proxy.address);

    testFeature = await TestFeature.new(lockStorage.address, versionManager.address, 0);
    testFeatureNew = await TestFeature.new(lockStorage.address, versionManager.address, 0);

    badFeature = await BadFeature.new(lockStorage.address, versionManager.address);
  });

  describe("relaying feature transactions", () => {
    it("should fail when _data is less than 36 bytes", async () => {
      const params = []; // the first argument is not the wallet address, which should make the relaying revert
      await truffleAssert.reverts(
        manager.relay(wallet, "clearInt", params, [owner]), "RM: Invalid dataWallet",
      );
    });

    it("should fail when feature is not authorised", async () => {
      const params = [wallet.address, 2];
      await truffleAssert.reverts(
        manager.relay(wallet, "setIntOwnerOnly", params, [owner]), "RM: feature not authorised",
      );
    });

    it("should fail when the first param is not the wallet", async () => {
      const params = [owner, 4];
      await truffleAssert.reverts(
        manager.relay(wallet, "setIntOwnerOnly", params, [owner]), "RM: Target of _data != _wallet",
      );
    });

    it("should fail when the gas of the transaction is less then the gasLimit", async () => {
      const nonce = await utils.getNonceForRelay();
      const gasLimit = 2000000;

      await truffleAssert.reverts(
        relayerManager.execute(
          "0xdeadbeef",
          nonce,
          "0xdeadbeef",
          0,
          gasLimit,
          ETH_TOKEN,
          ethers.constants.AddressZero,
          { gas: gasLimit * 0.9, gasPrice: 0, from: accounts[9] }
        ), "RM: not enough gas provided");
    });

    it("should fail when a wrong number of signatures is provided", async () => {
      const params = [wallet.address, 2];
      await truffleAssert.reverts(
        manager.relay(wallet, "setIntOwnerOnly", params, [owner, recipient]),
        "RM: Wrong number of signatures"
      );
    });

    it("should fail a duplicate transaction", async () => {
      const methodData = wallet.contract.methods.setIntOwnerOnly(wallet.address, 2).encodeABI();
      const nonce = await utils.getNonceForRelay();
      const chainId = await utils.getChainId();

      const signatures = await utils.signOffchain(
        [owner],
        wallet.address,
        wallet.address,
        0,
        methodData,
        chainId,
        nonce,
        0,
        0,
        ETH_TOKEN,
        ethers.constants.AddressZero,
      );

      await relayerManager.execute(
        methodData,
        nonce,
        signatures,
        0,
        0,
        ETH_TOKEN,
        ethers.constants.AddressZero,
        { from: accounts[9] });

      await truffleAssert.reverts(
        relayerManager.execute(
          methodData,
          nonce,
          signatures,
          0,
          0,
          ETH_TOKEN,
          ethers.constants.AddressZero,
          { from: accounts[9] }
        ), "RM: Duplicate request");
    });

    it("should fail when relaying to itself", async () => {
      const methodData = wallet.contract.methods.setIntOwnerOnly(wallet.address, 2).encodeABI();
      const params = [
        methodData,
        0,
        ethers.constants.HashZero,
        0,
        200000,
        ETH_TOKEN,
        ethers.constants.AddressZero,
      ];
      await truffleAssert.reverts(
        manager.relay(wallet, "execute", params, [owner]), "BF: disabled method",
      );
    });

    it("should update the nonce after the transaction", async () => {
      const nonceBefore = await wallet.getNonce();
      await manager.relay(wallet, "setIntOwnerOnly", [wallet.address, 2], [owner]);

      const nonceAfter = await wallet.getNonce();
      expect(nonceAfter).to.be.gt.BN(nonceBefore);
    });
  });

  describe("refund relayed transactions", () => {
    let erc20;
    beforeEach(async () => {
      const decimals = 12; // number of decimal for TOKN contract
      erc20 = await ERC20.new([infrastructure], 10000000, decimals); // TOKN contract with 10M tokens (10M TOKN for account[0])

      // Prices stored in registry = price per token * 10^(18-token decimals)
      const tokenRate = new BN(10).pow(new BN(19)).mul(new BN(51)); // 1 TOKN = 0.00051 ETH = 0.00051*10^18 ETH wei => *10^(18-decimals) = 0.00051*10^18 * 10^6 = 0.00051*10^24 = 51*10^19
      await tokenPriceRegistry.setPriceForTokenList([erc20.address], [tokenRate]);

      await wallet.setLimitAndDailySpent(10000000000, 0);
    });

    async function callAndRefund({ refundToken }) {
      const txReceipt = await manager.relay(wallet, "setIntOwnerOnly", [wallet.address, 2], [owner], 10000, refundToken, recipient);
      return txReceipt;
    }

    it("should refund in ETH", async () => {
      await wallet.send("100000000000000");
      const wBalanceStart = await utils.getBalance(wallet.address);
      const rBalanceStart = await utils.getBalance(recipient);
      await callAndRefund({ refundToken: ETH_TOKEN });
      const wBalanceEnd = await utils.getBalance(wallet.address);
      const rBalanceEnd = await utils.getBalance(recipient);
      const refund = wBalanceStart.sub(wBalanceEnd);
      // should have refunded ETH
      expect(refund).to.be.gt.BN(0);
      // should have refunded the recipient
      expect(refund).to.eq.BN(rBalanceEnd.sub(rBalanceStart));
    });

    it("should refund in ERC20", async () => {
      await erc20.transfer(wallet.address, "10000000000");
      const wBalanceStart = await erc20.balanceOf(wallet.address);
      const rBalanceStart = await erc20.balanceOf(recipient);
      await callAndRefund({ refundToken: erc20.address });
      const wBalanceEnd = await erc20.balanceOf(wallet.address);
      const rBalanceEnd = await erc20.balanceOf(recipient);
      const refund = wBalanceStart.sub(wBalanceEnd);
      // should have refunded ERC20
      expect(refund).to.be.gt.BN(0);
      // should have refunded the recipient
      expect(refund).to.eq.BN(rBalanceEnd.sub(rBalanceStart));
    });

    it("should emit the Refund event", async () => {
      await wallet.send("100000000000");
      const txReceipt = await callAndRefund({ refundToken: ETH_TOKEN });
      await utils.hasEvent(txReceipt, relayerManager, "Refund");
    });

    it("should fail the transaction when there is not enough ETH for the refund", async () => {
      await wallet.send(10);
      await truffleAssert.reverts(callAndRefund({ refundToken: ETH_TOKEN }), "VM: wallet invoke reverted");
    });

    it("should fail the transaction when there is not enough ERC20 for the refund", async () => {
      await erc20.transfer(wallet.address, 10);
      await truffleAssert.reverts(callAndRefund({ refundToken: erc20.address }), "ERC20: transfer amount exceeds balance");
    });

    it("should include the refund in the daily limit", async () => {
      await wallet.send("100000000000");
      await wallet.setLimitAndDailySpent("100000000000000000", 10);
      let dailySpent = await wallet.getDailySpent();
      expect(dailySpent).to.eq.BN(10);
      await callAndRefund({ refundToken: ETH_TOKEN });
      dailySpent = await wallet.getDailySpent();
      expect(dailySpent).to.be.gt.BN(10);
    });

    it("should refund and reset the daily limit when approved by guardians", async () => {
      // set funds and limit/daily spent
      await wallet.send("100000000000");
      await wallet.setLimitAndDailySpent(1000000000, 10);
      let dailySpent = await wallet.getDailySpent();
      // initial daily spent should be 10
      expect(dailySpent).to.eq.BN(10);
      const rBalanceStart = await utils.getBalance(recipient);
      // add a guardian
      await wallet.addGuardian(guardian, { from: owner });
      // call approvedTransfer
      const params = [ETH_TOKEN, recipient, 1000, ethers.constants.HashZero];
      await manager.relay(wallet, "transferToken", params, [owner, guardian]);

      dailySpent = await wallet.getDailySpent();
      // daily spent should be reset
      expect(dailySpent).to.be.zero;
      const rBalanceEnd = await utils.getBalance(recipient);
      expect(rBalanceEnd).to.be.gt.BN(rBalanceStart);
    });

    it("should fail if required signatures is 0 and OwnerRequirement is not Anyone", async () => {
      await truffleAssert.reverts(
        manager.relay(badFeature, "setIntOwnerOnly", [2], wallet, [owner]), "RM: Wrong signature requirement",
      );
    });

    it("should fail the transaction when the refund is over the daily limit", async () => {
      await wallet.send("100000000000");
      await wallet.setLimitAndDailySpent(1000000000, 999999990);
      const dailySpent = await wallet.getDailySpent();
      expect(dailySpent).to.eq.BN(999999990);
      await truffleAssert.reverts(callAndRefund({ refundToken: ETH_TOKEN }), "RM: refund is above daily limit");
    });
  });
});
