/* global artifacts */

const { expect } = require("chai");
const utils = require("../utils/utilities.js");
const { deployArgent } = require("../utils/argent-deployer.js");

const WethFilter = artifacts.require("WethFilter");

contract("WETH Filter", (accounts) => {
  let argent;
  let wallet;

  before(async () => {
    argent = await deployArgent(accounts);

    const filter = await WethFilter.new();
    await argent.dappRegistry.addDapp(0, argent.WETH.address, filter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet();
  });

  describe("WETH deposit and withdrawal", () => {
    it("should allow deposit", async () => {
      const { success, error } = await argent.multiCall(wallet, [
        [argent.WETH, "deposit", [], 100]
      ]);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const walletBalance = await argent.WETH.balanceOf(wallet.address);
      expect(walletBalance.toString()).to.equal("100");
    });

    it("should allow deposit using fallback", async () => {
      const { success, error } = await argent.multiCall(wallet, [utils.encodeTransaction(argent.WETH.address, 100, "0x")]);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const walletBalance = await argent.WETH.balanceOf(wallet.address);
      expect(walletBalance.toString()).to.equal("100");
    });

    it("should allow withdrawals", async () => {
      const { success, error } = await argent.multiCall(wallet, [
        [argent.WETH, "deposit", [], 100],
        [argent.WETH, "withdraw", ["75"]],
      ]);
      assert.isTrue(success, `deposit/withdrawal failed: "${error}"`);

      const walletBalance = await argent.WETH.balanceOf(wallet.address);
      expect(walletBalance.toString()).to.equal("25");
    });
  });
});
