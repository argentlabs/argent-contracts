/* global artifacts */
const truffleAssert = require("truffle-assertions");
const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

chai.use(bnChai(BN));

const TokenRegistry = artifacts.require("TokenRegistry");
const ERC20 = artifacts.require("TestERC20");

contract("TokenRegistry", (accounts) => {
  const owner = accounts[0];
  const manager = accounts[1];

  let tokenAddress;
  let tokenAddress2;
  let tokenRegistry;

  before(async () => {
    const token = await ERC20.new([], 1, 18);
    tokenAddress = token.address;
    const token2 = await ERC20.new([], 1, 18);
    tokenAddress2 = token2.address;
  });

  beforeEach(async () => {
    tokenRegistry = await TokenRegistry.new();
    await tokenRegistry.addManager(manager);
  });

  describe("Tradable status changes", () => {
    it("lets the owner change tradable status", async () => {
      await tokenRegistry.setTradableForTokenList([tokenAddress], [true], { from: owner });
      let tradable = await tokenRegistry.isTokenTradable(tokenAddress);
      assert.isTrue(tradable);
      await tokenRegistry.setTradableForTokenList([tokenAddress], [false], { from: owner });
      tradable = await tokenRegistry.isTokenTradable(tokenAddress);
      assert.isFalse(tradable);
      await tokenRegistry.setTradableForTokenList([tokenAddress], [true], { from: owner });
      tradable = await tokenRegistry.isTokenTradable(tokenAddress);
      assert.isTrue(tradable);
    });

    it("lets managers set tradable to false only", async () => {
      await tokenRegistry.setTradableForTokenList([tokenAddress], [true], { from: owner });
      await tokenRegistry.setTradableForTokenList([tokenAddress], [false], { from: manager });
      const tradable = await tokenRegistry.isTokenTradable(tokenAddress);
      assert.isFalse(tradable);
      await truffleAssert.reverts(tokenRegistry.setTradableForTokenList([tokenAddress], [true], { from: manager }), "TR: Unauthorised operation");
    });

    it("does not let managers change tradable with invalid array lengths", async () => {
      await truffleAssert.reverts(
        tokenRegistry.setTradableForTokenList([tokenAddress], [false, false], { from: manager }),
        "TR: Array length mismatch");
    });
  });

  describe("Reading tradable status", () => {
    it("lets managers read tradable information on multiple tokens", async () => {
      await tokenRegistry.setTradableForTokenList([tokenAddress], [true], { from: owner });
      let tradable = await tokenRegistry.areTokensTradable([tokenAddress, tokenAddress2]);
      assert.isFalse(tradable);

      await tokenRegistry.setTradableForTokenList([tokenAddress2], [true], { from: owner });
      tradable = await tokenRegistry.areTokensTradable([tokenAddress, tokenAddress2]);
      assert.isTrue(tradable);
    });
  });
});
