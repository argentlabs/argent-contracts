/* global artifacts */

const { BN } = require("bn.js");
const { assert } = require("chai");
const { deployArgent } = require("../utils/argent-deployer.js");
const utils = require("../utils/utilities.js");

const DepositHandler = artifacts.require("GroDepositHandler");
const WithdrawHandler = artifacts.require("GroWithdrawHandler");
const Controller = artifacts.require("GroController");
const DepositFilter = artifacts.require("GroDepositFilter");
const WithdrawFilter = artifacts.require("GroWithdrawFilter");
const ERC20 = artifacts.require("TestERC20");

const ethAmount = web3.utils.toWei("0.01");
const daiAmount = web3.utils.toWei("100");

contract("Gro Filter", (accounts) => {
  let argent;
  let wallet;

  let gvt;
  let pwrd;
  let depositHandler;
  let withdrawHandler;

  before(async () => {
    argent = await deployArgent(accounts);

    gvt = await ERC20.at("0x3ADb04E127b9C0a5D36094125669d4603AC52a0c");
    pwrd = await ERC20.at("0xf0a93d4994b3d98fb5e3a2f90dbc2d69073cb86b");

    const controller = await Controller.at("0xCC5c60A319D33810b9EaB9764717EeF84deFB8F4");
    await controller.switchEoaOnly(false, { from: "0xdc954086cf07f3889f186118395bad186179ac77" });

    depositHandler = await DepositHandler.at("0xB7207Ea9446DcA1dEC1c1FC93c6Fcdf8B4a44F40");
    withdrawHandler = await WithdrawHandler.at("0x641bEFA4dB601578A64F0Fc1f4E89E9869268Fe7");

    const depositFilter = await DepositFilter.new();
    const withdrawFilter = await WithdrawFilter.new();

    await argent.dappRegistry.addDapp(0, depositHandler.address, depositFilter.address);
    await argent.dappRegistry.addDapp(0, withdrawHandler.address, withdrawFilter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet({
      DAI: daiAmount,
      WETH: ethAmount,
    });
  });

  const deposit = async (isPwrd) => argent.multiCall(wallet, [
    [argent.DAI, "approve", [depositHandler.address, daiAmount]],
    [depositHandler, isPwrd ? "depositPwrd" : "depositGvt", [[daiAmount, 0, 0], 1, utils.ZERO_ADDRESS]]
  ]);

  const withdrawByLPToken = async (isPwrd, withdrawAmount) => argent.multiCall(wallet, [
    [withdrawHandler, "withdrawByLPToken", [isPwrd, withdrawAmount, [1, 1, 1]]]
  ]);

  const withdrawByStablecoin = async (isPwrd, withdrawAmount) => argent.multiCall(wallet, [
    [withdrawHandler, "withdrawByStablecoin", [isPwrd, 0, withdrawAmount, 1]]
  ]);

  const withdrawAllSingle = async (isPwrd) => argent.multiCall(wallet, [
    [withdrawHandler, "withdrawAllSingle", [isPwrd, 0, 1]]
  ]);

  const withdrawAllBalanced = async (isPwrd) => argent.multiCall(wallet, [
    [withdrawHandler, "withdrawAllBalanced", [isPwrd, [1, 1, 1]]]
  ]);

  describe("Gvt", () => {
    const isPwrd = false;

    it("should allow deposits", async () => {
      const { success, error } = await utils.swapAndCheckBalances({
        swap: () => deposit(isPwrd),
        bought: gvt,
        sold: argent.DAI,
        wallet,
      });
      assert.isTrue(success, `depositGvt failed: "${error}"`);
    });

    it("should allow withdrawals (1/4)", async () => {
      await deposit(isPwrd);

      const lpAmount = (await gvt.balanceOf(wallet.address)).divn(new BN(2)).toString();
      const { success, error } = await utils.swapAndCheckBalances({
        swap: () => withdrawByLPToken(isPwrd, lpAmount),
        bought: argent.DAI,
        sold: gvt,
        wallet,
      });
      assert.isTrue(success, `withdrawByLPToken failed: "${error}"`);
    });

    it("should allow withdrawals (2/4)", async () => {
      await deposit(isPwrd);
      const lpAmount = (await gvt.balanceOf(wallet.address)).divn(new BN(2)).toString();
      const { success, error } = await withdrawByStablecoin(isPwrd, lpAmount);
      assert.isTrue(success, `withdrawByStablecoin failed: "${error}"`);
    });

    it("should allow withdrawals (3/4)", async () => {
      await deposit(isPwrd);
      const { success, error } = await withdrawAllSingle(isPwrd);
      assert.isTrue(success, `withdrawAllSingle failed: "${error}"`);
    });

    it("should allow withdrawals (4/4)", async () => {
      await deposit(isPwrd);
      const { success, error } = await withdrawAllBalanced(isPwrd);
      assert.isTrue(success, `withdrawAllBalanced failed: "${error}"`);
    });
  });

  describe("Pwrd", () => {
    const isPwrd = true;

    it("should allow deposits", async () => {
      const { success, error } = await utils.swapAndCheckBalances({
        swap: () => deposit(isPwrd),
        bought: pwrd,
        sold: argent.DAI,
        wallet,
      });
      assert.isTrue(success, `depositPwrd failed: "${error}"`);
    });

    it("should allow withdrawals (1/4)", async () => {
      await deposit(isPwrd);
      const lpAmount = (await pwrd.balanceOf(wallet.address)).divn(new BN(2)).toString();
      const { success, error } = await withdrawByLPToken(isPwrd, lpAmount);
      assert.isTrue(success, `withdrawByLPToken failed: "${error}"`);
    });

    it("should allow withdrawals (2/4)", async () => {
      await deposit(isPwrd);
      const lpAmount = (await pwrd.balanceOf(wallet.address)).divn(new BN(2)).toString();
      const { success, error } = await withdrawByStablecoin(isPwrd, lpAmount);
      assert.isTrue(success, `withdrawByStablecoin failed: "${error}"`);
    });

    it("should allow withdrawals (3/4)", async () => {
      await deposit(isPwrd);
      const { success, error } = await withdrawAllSingle(isPwrd);
      assert.isTrue(success, `withdrawAllSingle failed: "${error}"`);
    });

    it("should allow withdrawals (4/4)", async () => {
      await deposit(isPwrd);
      const { success, error } = await withdrawAllBalanced(isPwrd);
      assert.isTrue(success, `withdrawAllBalanced failed: "${error}"`);
    });
  });

  it("should not allow direct transfers to deposit handler", async () => {
    const { success, error } = await argent.multiCall(wallet, [
      [argent.WETH, "transfer", [depositHandler.address, ethAmount]]
    ]);
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow direct transfers to withdraw handler", async () => {
    const { success, error } = await argent.multiCall(wallet, [
      [argent.WETH, "transfer", [withdrawHandler.address, ethAmount]]
    ]);
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH to deposit handler", async () => {
    const transaction = utils.encodeTransaction(depositHandler.address, ethAmount, "0x");
    const { success, error } = await argent.multiCall(wallet, [transaction]);
    assert.isFalse(success, "sending ETH to deposit handler should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH to withdraw handler", async () => {
    const transaction = utils.encodeTransaction(withdrawHandler.address, ethAmount, "0x");
    const { success, error } = await argent.multiCall(wallet, [transaction]);
    assert.isFalse(success, "sending ETH to withdrawal handler should have failed");
    assert.equal(error, "TM: call not authorised");
  });
});
