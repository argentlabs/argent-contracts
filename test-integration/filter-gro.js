/* global artifacts */

const { assert } = require("chai");
const ArgentContext = require("../utils/argent-context.js");
const utils = require("../utils/utilities.js");

const DepositHandler = artifacts.require("GroDepositHandler");
const WithdrawHandler = artifacts.require("GroWithdrawHandler");
const Controller = artifacts.require("GroController");
const DepositFilter = artifacts.require("GroDepositFilter");
const WithdrawFilter = artifacts.require("GroWithdrawFilter");

const amount = web3.utils.toWei("0.01");

contract("Gro Filter", (accounts) => {
  let argent;
  let wallet;

  let depositHandler;
  let withdrawHandler;

  before(async () => {
    argent = await new ArgentContext(accounts).initialize();

    const controller = await Controller.at("0xCC5c60A319D33810b9EaB9764717EeF84deFB8F4");
    await controller.switchEoaOnly(false, { from: "0xdc954086cf07f3889f186118395bad186179ac77" });

    depositHandler = await DepositHandler.at("0xB7207Ea9446DcA1dEC1c1FC93c6Fcdf8B4a44F40");
    const depositFilter = await DepositFilter.new();
    await argent.dappRegistry.addDapp(0, depositHandler.address, depositFilter.address);

    withdrawHandler = await WithdrawHandler.at("0x641bEFA4dB601578A64F0Fc1f4E89E9869268Fe7");
    const withdrawFilter = await WithdrawFilter.new();
    await argent.dappRegistry.addDapp(0, withdrawHandler.address, withdrawFilter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet({
      DAI: web3.utils.toWei("1"),
      WETH: amount,
    });
  });

  const deposit = async (isPwrd) => argent.multiCall(wallet, [
    [argent.DAI, "approve", [depositHandler.address, amount]],
    [depositHandler, isPwrd ? "depositPwrd" : "depositGvt", [[amount, 0, 0], 1, utils.ZERO_ADDRESS]]
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
      const { success, error } = await deposit(isPwrd);
      assert.isTrue(success, `depositGvt failed: "${error}"`);
    });

    it.skip("should allow withdrawals (1/4)", async () => {
      await deposit(isPwrd);
      const { success, error } = await withdrawByLPToken(isPwrd, 10);
      assert.isTrue(success, `withdrawByLPToken failed: "${error}"`);
    });

    it("should allow withdrawals (2/4)", async () => {
      await deposit(isPwrd);
      const { success, error } = await withdrawByStablecoin(isPwrd, 10);
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
      const { success, error } = await deposit(isPwrd);
      assert.isTrue(success, `depositPwrd failed: "${error}"`);
    });

    it.skip("should allow withdrawals (1/4)", async () => {
      await deposit(isPwrd);
      const { success, error } = await withdrawByLPToken(isPwrd, 10);
      assert.isTrue(success, `withdrawByLPToken failed: "${error}"`);
    });

    it("should allow withdrawals (2/4)", async () => {
      await deposit(isPwrd);
      const { success, error } = await withdrawByStablecoin(isPwrd, 10);
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
      [argent.WETH, "transfer", [depositHandler.address, amount]]
    ]);
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow direct transfers to withdraw handler", async () => {
    const { success, error } = await argent.multiCall(wallet, [
      [argent.WETH, "transfer", [withdrawHandler.address, amount]]
    ]);
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH to deposit handler", async () => {
    const transaction = utils.encodeTransaction(depositHandler.address, amount, "0x");
    const { success, error } = await argent.multiCall(wallet, [transaction], { encode: false });
    assert.isFalse(success, "sending ETH to deposit handler should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH to withdraw handler", async () => {
    const transaction = utils.encodeTransaction(withdrawHandler.address, amount, "0x");
    const { success, error } = await argent.multiCall(wallet, [transaction], { encode: false });
    assert.isFalse(success, "sending ETH to withdrawal handler should have failed");
    assert.equal(error, "TM: call not authorised");
  });
});
