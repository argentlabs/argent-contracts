/* global artifacts */

const { assert, expect } = require("chai");
const ethers = require("ethers");
const ArgentContext = require("../utils/argent-context.js");
const utils = require("../utils/utilities.js");

const CErc20 = artifacts.require("CErc20");
const CompoundCTokenFilter = artifacts.require("CompoundCTokenFilter");

const amount = web3.utils.toWei("1");

contract("Compound Filter", (accounts) => {
  let argent, wallet;
  let cEther, cDai;

  before(async () => {
    argent = await new ArgentContext(accounts).initialize();

    cEther = await CErc20.at("0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5");
    const cEtherFilter = await CompoundCTokenFilter.new(ethers.constants.AddressZero);
    await argent.dappRegistry.addDapp(0, cEther.address, cEtherFilter.address);

    cDai = await CErc20.at("0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643");
    const cDaiFilter = await CompoundCTokenFilter.new(argent.DAI.address);
    await argent.dappRegistry.addDapp(0, cDai.address, cDaiFilter.address);
  });

  describe("Testing cETH", function () {
    beforeEach(async () => {
      wallet = await argent.createFundedWallet();
    });

    const mint = async () => {
      const tokenBefore = await utils.getBalance(wallet.address);
      const cTokenBefore = await cEther.balanceOf(wallet.address);

      const { success, error, receipt } = await argent.multiCall(wallet, [
        [cEther, "mint", [amount]]
      ]);
      assert.isTrue(success, `mint failed: "${error}"`);

      await utils.hasEvent(receipt, cEther, "Mint");

      const tokenAfter = await utils.getBalance(wallet.address);
      const cTokenAfter = await cEther.balanceOf(wallet.address);

      expect(tokenBefore.sub(tokenAfter)).to.be.gt.BN(0);
      expect(cTokenAfter.sub(cTokenBefore)).to.be.gt.BN(0);
    };

    it("should allow minting", async () => {
      await mint();
    });

    it("should allow redeeming", async () => {
      await mint();
      const { success, error } = await argent.multiCall(wallet, [
        [cDai, "redeem", [amount]]
      ]);
      assert.isTrue(success, `withdrawal failed: "${error}"`);
    });
  });

  describe("Testing cDAI", function () {
    beforeEach(async () => {
      wallet = await argent.createFundedWallet({ DAI: amount });
    });

    const mint = async () => {
      const tokenBefore = await argent.DAI.balanceOf(wallet.address);
      const cTokenBefore = await cDai.balanceOf(wallet.address);

      const { success, error, receipt } = await argent.multiCall(wallet, [
        [argent.DAI, "approve", [cDai.address, amount]],
        [cDai, "mint", [amount]]
      ]);
      assert.isTrue(success, `mint failed: "${error}"`);

      await utils.hasEvent(receipt, cDai, "Mint");
      const tokenAfter = await argent.DAI.balanceOf(wallet.address);
      const cTokenAfter = await cDai.balanceOf(wallet.address);

      expect(tokenBefore.sub(tokenAfter)).to.be.gt.BN(0);
      expect(cTokenAfter.sub(cTokenBefore)).to.be.gt.BN(0);
    };

    it("should allow minting", async () => {
      await mint();
    });

    it("should allow redeems", async () => {
      await mint();
      const { success, error } = await argent.multiCall(wallet, [
        [cDai, "redeem", [amount]]
      ]);
      assert.isTrue(success, `redeem failed: "${error}"`);
    });
  });
});
