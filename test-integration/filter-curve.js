/* global artifacts */

const { expect } = require("chai");
const utils = require("../utils/utilities.js");
const ArgentContext = require("../utils/argent-context.js");

const CurvePool = artifacts.require("CurvePoolMock");
const CurveFilter = artifacts.require("CurveFilter");

contract("WETH Filter", (accounts) => {
  let argent, wallet;
  let curve2, curve3, curve4;

  before(async () => {
    argent = await new ArgentContext(accounts).initialize();

    curve2 = await CurvePool.at("0xDC24316b9AE028F1497c275EB9192a3Ea0f67022");
    curve3 = await CurvePool.at("0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7");
    curve4 = await CurvePool.at("0xA5407eAE9Ba41422680e2e00537571bcC53efBfD");
    const curveFilter = await CurveFilter.new();
    await argent.dappRegistry.addDapp(0, curve2.address, curveFilter.address);
    await argent.dappRegistry.addDapp(0, curve3.address, curveFilter.address);
    await argent.dappRegistry.addDapp(0, curve4.address, curveFilter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet();
  });

  describe("Testing filter for 2 token pool (stEth)", () => {
    it("should swap", async () => {
      const { success, error } = await argent.multiCall(wallet, [
        [curve2, "exchange", [1, 0, 99, 1]]
      ]);
      assert.isTrue(success, `exchange failed: "${error}"`);
    });
  });

  describe("Testing filter for 3 token pool (DAI/USDC/USDT)", () => {
    it("should swap", async () => {
      const { success, error } = await argent.multiCall(wallet, [
        [curve3, "exchange", [1, 0, 99, 1]]
      ]);
      assert.isTrue(success, `exchange failed: "${error}"`);
    });
  });

});
