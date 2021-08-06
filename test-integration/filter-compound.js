/* global artifacts */

const { assert } = require("chai");
const ArgentContext = require("../utils/argent-context.js");
const utils = require("../utils/utilities.js");

const CErc20 = artifacts.require("CErc20");
const CEther = artifacts.require("CEther");
const CompoundCTokenFilter = artifacts.require("CompoundCTokenFilter");

contract("Compound Filter", (accounts) => {
  let argent;
  let wallet;
  let cEther;
  let cDai;

  before(async () => {
    argent = await new ArgentContext(accounts).initialise();

    cEther = await CEther.at("0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5");
    cDai = await CErc20.at("0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643");

    const cEtherFilter = await CompoundCTokenFilter.new(utils.ZERO_ADDRESS);
    const cDaiFilter = await CompoundCTokenFilter.new(argent.DAI.address);

    await argent.dappRegistry.addDapp(0, cEther.address, cEtherFilter.address);
    await argent.dappRegistry.addDapp(0, cDai.address, cDaiFilter.address);
  });

  describe("Testing cETH", () => {
    const amount = web3.utils.toWei("0.01");

    beforeEach(async () => {
      wallet = await argent.createFundedWallet();
    });

    const mint = async (useFallback) => argent.multiCall(wallet, [
      useFallback
        ? utils.encodeTransaction(cEther.address, amount, "0x")
        : [cEther, "mint", [], amount]
    ]);

    it("should allow minting", async () => {
      const { success, error, receipt } = await utils.checkBalances(wallet, utils.ETH_TOKEN, cEther, mint);

      assert.isTrue(success, `mint failed: "${error}"`);
      await utils.hasEvent(receipt, cEther, "Mint");
    });

    it("should allow minting using fallback", async () => {
      const { success, error, receipt } = await utils.checkBalances(wallet, utils.ETH_TOKEN, cEther, () => mint(true));

      assert.isTrue(success, `mint failed: "${error}"`);
      await utils.hasEvent(receipt, cEther, "Mint");
    });

    it("should allow redeeming", async () => {
      await mint();

      const redeemAmount = await cEther.balanceOf(wallet.address);
      const { success, error, receipt } = await utils.checkBalances(wallet, cEther, utils.ETH_TOKEN, () => (
        argent.multiCall(wallet, [
          [cEther, "redeem", [redeemAmount.toString()]]
        ])
      ));

      assert.isTrue(success, `withdrawal failed: "${error}"`);
      await utils.hasEvent(receipt, cEther, "Redeem");
    });
  });

  describe("Testing cDAI", () => {
    const amount = web3.utils.toWei("1");

    beforeEach(async () => {
      wallet = await argent.createFundedWallet({ DAI: amount });
    });

    const mint = async () => argent.multiCall(wallet, [
      [argent.DAI, "approve", [cDai.address, amount]],
      [cDai, "mint", [amount]]
    ]);

    it("should allow minting", async () => {
      const { success, error, receipt } = await utils.checkBalances(wallet, argent.DAI, cDai, mint);

      assert.isTrue(success, `mint failed: "${error}"`);
      await utils.hasEvent(receipt, cDai, "Mint");
    });

    it("should allow redeeming", async () => {
      await mint();

      const redeemAmount = await cDai.balanceOf(wallet.address);
      const { success, error, receipt } = await utils.checkBalances(wallet, cDai, argent.DAI, () => (
        argent.multiCall(wallet, [
          [cDai, "redeem", [redeemAmount.toString()]]
        ])
      ));

      assert.isTrue(success, `redeem failed: "${error}"`);
      await utils.hasEvent(receipt, cDai, "Redeem");
    });
  });
});
