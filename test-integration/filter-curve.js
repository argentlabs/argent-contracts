/* global artifacts */

const { BN } = require("bn.js");
const utils = require("../utils/utilities.js");
const { deployArgent } = require("../utils/argent-deployer.js");

const CurvePool = artifacts.require("CurvePoolMock");
const CurveFilter = artifacts.require("CurveFilter");
const ERC20 = artifacts.require("TestERC20");

const amount = web3.utils.toWei("10");
const usdcAmount = utils.usdcToWei("10");
const ethAmount = web3.utils.toWei("0.01");

contract("Curve Filter", (accounts) => {
  let argent;
  let wallet;

  let curve2;
  let curve3;
  let curve4;

  let lpToken2;
  let lpToken3;
  let lpToken4;

  before(async () => {
    argent = await deployArgent(accounts);

    curve2 = await CurvePool.at("0xDC24316b9AE028F1497c275EB9192a3Ea0f67022");
    curve3 = await CurvePool.at("0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7");
    curve4 = await CurvePool.at("0xA5407eAE9Ba41422680e2e00537571bcC53efBfD");

    lpToken2 = await ERC20.at("0x06325440d014e39736583c165c2963ba99faf14e");
    lpToken3 = await ERC20.at("0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490");
    lpToken4 = await ERC20.at("0xC25a3A3b969415c80451098fa907EC722572917F");

    const filter = await CurveFilter.new();

    await argent.dappRegistry.addDapp(0, curve2.address, filter.address);
    await argent.dappRegistry.addDapp(0, curve3.address, filter.address);
    await argent.dappRegistry.addDapp(0, curve4.address, filter.address);
  });

  describe("Testing filter for 2 token pool (stEth)", () => {
    beforeEach(async () => {
      wallet = await argent.createFundedWallet({
        ETH: new BN(ethAmount).mul(new BN(2)),
        stETH: ethAmount,
      });
    });

    const deposit = async () => argent.multiCall(wallet, [
      [argent.stETH, "approve", [curve2.address, ethAmount]],
      [curve2, "add_liquidity(uint256[2],uint256)", [[ethAmount, ethAmount], 1], ethAmount]
    ]);

    it("should allow deposits", async () => {
      const { success, error } = await deposit();
      assert.isTrue(success, `deposit2 failed: "${error}"`);
    });

    it("should allow withdrawals", async () => {
      await deposit();

      const withdrawalAmount = (await lpToken2.balanceOf(wallet.address)).div(new BN(2)).toString();
      const { success, error } = await argent.multiCall(wallet, [
        [curve2, "remove_liquidity(uint256,uint256[2])", [withdrawalAmount, [1, 1]]]
      ]);
      assert.isTrue(success, `withdraw2 failed: "${error}"`);
    });

    it("should swap", async () => {
      const swapAmount = new BN(ethAmount).div(new BN(2)).toString();
      const { success, error } = await argent.multiCall(wallet, [
        [curve2, "exchange", [0, 1, swapAmount, 1], swapAmount]
      ]);
      assert.isTrue(success, `exchange failed: "${error}"`);
    });
  });

  describe("Testing filter for 3 token pool (DAI/USDC/USDT)", () => {
    beforeEach(async () => {
      wallet = await argent.createFundedWallet({
        DAI: amount,
        USDC: usdcAmount,
        USDT: amount,
      });
    });

    const deposit = async () => argent.multiCall(wallet, [
      [argent.DAI, "approve", [curve3.address, amount]],
      [argent.USDC, "approve", [curve3.address, usdcAmount]],
      [argent.USDT, "approve", [curve3.address, amount]],
      [curve3, "add_liquidity(uint256[3],uint256)", [[amount, usdcAmount, amount], 1]]
    ]);

    it("should allow deposits", async () => {
      const { success, error } = await deposit();
      assert.isTrue(success, `deposit3 failed: "${error}"`);
    });

    it("should allow withdrawals", async () => {
      await deposit();

      const withdrawalAmount = (await lpToken3.balanceOf(wallet.address)).div(new BN(2)).toString();
      const { success, error } = await argent.multiCall(wallet, [
        [curve3, "remove_liquidity(uint256,uint256[3])", [withdrawalAmount, [1, 1, 1]]]
      ]);
      assert.isTrue(success, `withdraw3 failed: "${error}"`);
    });

    it("should swap", async () => {
      const { success, error } = await argent.multiCall(wallet, [
        [argent.DAI, "approve", [curve3.address, amount]],
        [curve3, "exchange", [0, 1, amount, 1]]
      ]);
      assert.isTrue(success, `exchange failed: "${error}"`);
    });
  });

  describe("Testing filter for 4 token pool (sUsd v2)", () => {
    beforeEach(async () => {
      wallet = await argent.createFundedWallet({
        DAI: amount,
        USDC: usdcAmount,
        USDT: amount,
        sUSD: amount,
      });
    });

    const deposit = async () => argent.multiCall(wallet, [
      [argent.DAI, "approve", [curve4.address, amount]],
      [argent.USDC, "approve", [curve4.address, usdcAmount]],
      [argent.USDT, "approve", [curve4.address, amount]],
      [argent.sUSD, "approve", [curve4.address, amount]],
      [curve4, "add_liquidity(uint256[4],uint256)", [[amount, usdcAmount, amount, amount], 1]]
    ]);

    it("should allow deposits", async () => {
      const { success, error } = await deposit();
      assert.isTrue(success, `deposit4 failed: "${error}"`);
    });

    it("should allow withdrawals", async () => {
      await deposit();

      const withdrawalAmount = (await lpToken4.balanceOf(wallet.address)).div(new BN(2)).toString();
      const { success, error } = await argent.multiCall(wallet, [
        [curve4, "remove_liquidity(uint256,uint256[4])", [withdrawalAmount, [1, 1, 1, 1]]]
      ]);
      assert.isTrue(success, `withdraw4 failed: "${error}"`);
    });

    it("should swap", async () => {
      const { success, error } = await argent.multiCall(wallet, [
        [argent.DAI, "approve", [curve4.address, amount]],
        [curve4, "exchange", [0, 2, amount, 1]]
      ]);
      assert.isTrue(success, `exchange failed: "${error}"`);
    });

    it("should swap underlying", async () => {
      const { success, error } = await argent.multiCall(wallet, [
        [argent.DAI, "approve", [curve4.address, amount]],
        [curve4, "exchange_underlying", [0, 2, amount, 1]]
      ]);
      assert.isTrue(success, `exchange underlying failed: "${error}"`);
    });
  });

  describe("Failure cases", () => {
    beforeEach(async () => {
      wallet = await argent.createFundedWallet();
    });

    it("should not allow direct transfers to pool", async () => {
      const { success, error } = await argent.multiCall(wallet, [[argent.WETH, "transfer", [curve2.address, ethAmount]]]);
      assert.isFalse(success, "transfer should have failed");
      assert.equal(error, "TM: call not authorised");
    });

    it("should not allow calling unsupported method", async () => {
      const { success, error } = await argent.multiCall(wallet, [[curve2, "get_virtual_price", []]]);
      assert.isFalse(success, "get_virtual_price() should have failed");
      assert.equal(error, "TM: call not authorised");
    });

    it("should not allow sending ETH ", async () => {
      const { success, error } = await argent.multiCall(wallet, [utils.encodeTransaction(curve2.address, ethAmount, "0x")]);
      assert.isFalse(success, "sending ETH should have failed");
      assert.equal(error, "TM: call not authorised");
    });
  });
});
