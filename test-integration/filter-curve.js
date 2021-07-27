/* global artifacts */

const ArgentContext = require("../utils/argent-context.js");

const CurvePool = artifacts.require("CurvePoolMock");
const CurveFilter = artifacts.require("CurveFilter");

contract("Curve Filter", (accounts) => {
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

  describe("Testing filter for 2 token pool (stEth)", () => {
    before(async () => {
      wallet = await argent.createFundedWallet();
    });

    it("should swap", async () => {
      const amount = web3.utils.toWei("0.01");
      const { success, error } = await argent.multiCall(wallet, [
        [curve2, "exchange", [0, 1, amount, 1], amount]
      ]);
      assert.isTrue(success, `exchange failed: "${error}"`);
    });
  });

  describe("Testing filter for 3 token pool (DAI/USDC/USDT)", () => {
    before(async () => {
      wallet = await argent.createFundedWallet({ DAI: "1" });
    });

    it("should swap", async () => {
      const amount = web3.utils.toWei("1");
      const { success, error } = await argent.multiCall(wallet, [
        [argent.DAI, "approve", [curve3.address, amount]],
        [curve3, "exchange", [0, 1, amount, 1]]
      ]);
      assert.isTrue(success, `exchange failed: "${error}"`);
    });
  });

  describe("Testing filter for 4 token pool (sUsd v2)", () => {
    before(async () => {
      wallet = await argent.createFundedWallet({ DAI: "1" });
    });

    it("should swap", async () => {
      const amount = web3.utils.toWei("1");
      const { success, error } = await argent.multiCall(wallet, [
        [argent.DAI, "approve", [curve4.address, amount]],
        [curve4, "exchange", [0, 1, amount, 1]]
      ]);
      assert.isTrue(success, `exchange failed: "${error}"`);
    });
  });
});
