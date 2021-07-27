/* global artifacts */

const { expect } = require("chai");
const utils = require("../utils/utilities.js");
const ArgentContext = require("../utils/argent-context.js");

const WethFilter = artifacts.require("WethFilter");
const WETH = artifacts.require("WETH9");

contract("WETH Filter", (accounts) => {
  let argent, wallet;
  let weth;

  before(async () => {
    argent = await new ArgentContext(accounts).initialize();

    weth = await WETH.at("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");

    const filter = await WethFilter.new();
    await argent.dappRegistry.addDapp(0, weth.address, filter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet();
  });

  describe("WETH deposit and withdrawal", () => {
    it("should allow deposit", async () => {
      const { success, error } = await argent.multiCall(wallet, [
        [weth, "deposit", [], 100]
      ]);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const walletBalance = await weth.balanceOf(wallet.address);
      expect(walletBalance.toString()).to.equal("100");
    });

    it("should allow deposit using fallback", async () => {
      const transaction = utils.encodeTransaction(weth.address, 100, "0x");

      const receipt = await argent.multiCallRaw(wallet, [transaction]);
      const { success, error } = utils.parseRelayReceipt(receipt);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const walletBalance = await weth.balanceOf(wallet.address);
      expect(walletBalance.toString()).to.equal("100");
    });

    it("should allow withdrawals", async () => {
      const { success, error } = await argent.multiCall(wallet, [
        [weth, "deposit", [], 100],
        [weth, "withdraw", ["75"]],
      ]);
      assert.isTrue(success, `deposit/withdrawal failed: "${error}"`);

      const walletBalance = await weth.balanceOf(wallet.address);
      expect(walletBalance.toString()).to.equal("25");
    });
  });
});
