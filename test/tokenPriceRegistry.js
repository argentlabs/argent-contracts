/* global artifacts */

const TokenPriceRegistry = artifacts.require("TokenPriceRegistry");
const ERC20 = artifacts.require("TestERC20");

const { increaseTime, assertRevert } = require("../utils/utilities.js");

contract("TokenPriceRegistry", (accounts) => {
  const owner = accounts[0];
  const manager = accounts[1];

  let tokenAddress;
  let tokenPriceRegistry;

  before(async () => {
    const token = await ERC20.new([], 1, 18);
    tokenAddress = token.address;
  });

  beforeEach(async () => {
    tokenPriceRegistry = await TokenPriceRegistry.new();
    await tokenPriceRegistry.addManager(manager);
    await tokenPriceRegistry.setMinPriceUpdatePeriod(3600);
  });

  describe("Price changes", () => {
    it("lets managers change price after security period", async () => {
      await tokenPriceRegistry.setPriceForTokenList([tokenAddress], [111111], { from: manager });
      const beforePrice = await tokenPriceRegistry.getTokenPrice(tokenAddress);
      assert.equal(beforePrice.toString(), "111111");
      await increaseTime(3601);
      await tokenPriceRegistry.setPriceForTokenList([tokenAddress], [222222], { from: manager });
      const afterPrice = await tokenPriceRegistry.getTokenPrice(tokenAddress);
      assert.equal(afterPrice.toString(), "222222");
    });

    it("does not let managers change price with invalid array lengths", async () => {
      await assertRevert(tokenPriceRegistry.setPriceForTokenList([tokenAddress], [222222, 333333], { from: manager }), "TPS: Array length mismatch");
    });

    it("does not let managers change price before security period", async () => {
      await tokenPriceRegistry.setPriceForTokenList([tokenAddress], [111111], { from: manager });
      await increaseTime(3500);
      await assertRevert(tokenPriceRegistry.setPriceForTokenList([tokenAddress], [222222], { from: manager }), "TPS: Price updated too early");
    });

    it("lets the owner change security period", async () => {
      await tokenPriceRegistry.setPriceForTokenList([tokenAddress], [111111], { from: manager });
      await increaseTime(1600);
      await assertRevert(tokenPriceRegistry.setPriceForTokenList([tokenAddress], [222222], { from: manager }), "TPS: Price updated too early");
      await tokenPriceRegistry.setMinPriceUpdatePeriod(0, { from: owner });
      await tokenPriceRegistry.setPriceForTokenList([tokenAddress], [222222], { from: manager });
      const afterPrice = await tokenPriceRegistry.getTokenPrice(tokenAddress);
      assert.equal(afterPrice.toString(), "222222");
    });
  });

  describe("Tradable status changes", () => {
    it("lets the owner change tradable status", async () => {
      await tokenPriceRegistry.setTradableForTokenList([tokenAddress], [true], { from: owner });
      let tradable = await tokenPriceRegistry.isTokenTradable(tokenAddress);
      assert.isTrue(tradable);
      await tokenPriceRegistry.setTradableForTokenList([tokenAddress], [false], { from: owner });
      tradable = await tokenPriceRegistry.isTokenTradable(tokenAddress);
      assert.isFalse(tradable);
      await tokenPriceRegistry.setTradableForTokenList([tokenAddress], [true], { from: owner });
      tradable = await tokenPriceRegistry.isTokenTradable(tokenAddress);
      assert.isTrue(tradable);
    });
    it("lets managers set tradable to false only", async () => {
      await tokenPriceRegistry.setTradableForTokenList([tokenAddress], [true], { from: owner });
      await tokenPriceRegistry.setTradableForTokenList([tokenAddress], [false], { from: manager });
      const tradable = await tokenPriceRegistry.isTokenTradable(tokenAddress);
      assert.isFalse(tradable);
      await assertRevert(tokenPriceRegistry.setTradableForTokenList([tokenAddress], [true], { from: manager }), "TPS: Unauthorised");
    });
    it("does not let managers change tradable with invalid array lengths", async () => {
      await assertRevert(tokenPriceRegistry.setTradableForTokenList([tokenAddress], [false, false], { from: manager }), "TPS: Array length mismatch");
    });
  });
});
