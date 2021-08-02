/* global artifacts */

const { assert } = require("chai");
const ArgentContext = require("../utils/argent-context.js");
const utils = require("../utils/utilities.js");

const DepositHandler = artifacts.require("DepositHandlerMock");
const WithdrawHandler = artifacts.require("WithdrawHandlerMock");
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

    depositHandler = await DepositHandler.at("0x79b14d909381D79B655C0700d0fdc2C7054635b9");
    const depositFilter = await DepositFilter.new();
    await argent.dappRegistry.addDapp(0, depositHandler.address, depositFilter.address);

    withdrawHandler = await WithdrawHandler.at("0xd89512Bdf570476310DE854Ef69D715E0e85B09F");
    const withdrawFilter = await WithdrawFilter.new();
    await argent.dappRegistry.addDapp(0, withdrawHandler.address, withdrawFilter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet({
      DAI: web3.utils.toWei("1"),
      WETH: web3.utils.toWei("0.01"),
    });
  });

  const depositGvt = async () => argent.multiCall(wallet, [
    [argent.DAI, "approve", [depositHandler.address, amount]],
    [depositHandler, "depositGvt", [[amount, 0, 0], 1, utils.ZERO_ADDRESS]]
  ]);
  
  const depositPwrd = async () => argent.multiCall(wallet, [
    [argent.DAI, "approve", [depositHandler.address, amount]],
    [depositHandler, "depositPwrd", [[amount, 0, 0], 1, utils.ZERO_ADDRESS]]
  ]);

  const withdrawByLPToken = async () => argent.multiCall(wallet, [
    [withdrawHandler, "withdrawByLPToken", [true, amount, [1, 1, 1]]]
  ]);

  const withdrawByStablecoin = async () => argent.multiCall(wallet, [
    [withdrawHandler, "withdrawByStablecoin", [true, 0, amount, 1]]
  ]);

  const withdrawAllSingle = async () => argent.multiCall(wallet, [
    [withdrawHandler, "withdrawAllSingle", [true, 0, 1]]
  ]);

  const withdrawAllBalanced = async () => argent.multiCall(wallet, [
    [withdrawHandler, "withdrawAllBalanced", [true, [1, 1, 1]]]
  ]);

  it("should allow deposits (1/2)", async () => {
    const { success, error } = await depositGvt();
    assert.isTrue(success, `deposit1 failed: "${error}"`);
  });

  it("should allow deposits (2/2)", async () => {
    const { success, error } = await depositPwrd();
    assert.isTrue(success, `deposit2 failed: "${error}"`);
  });

  it("should allow withdrawals (1/4)", async () => {
    await depositGvt();
    const { success, error } = await withdrawByLPToken();
    assert.isTrue(success, `withdraw1 failed: "${error}"`);
  });

  it("should allow withdrawals (2/4)", async () => {
    await depositGvt();
    const { success, error } = await withdrawByStablecoin();
    assert.isTrue(success, `withdraw2 failed: "${error}"`);
  });

  it("should allow withdrawals (3/4)", async () => {
    await depositGvt();
    const { success, error } = await withdrawAllSingle();
    assert.isTrue(success, `withdraw3 failed: "${error}"`);
  });

  it("should allow withdrawals (4/4)", async () => {
    await depositGvt();
    const { success, error } = await withdrawAllBalanced();
    assert.isTrue(success, `withdraw4 failed: "${error}"`);
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

  it("should not allow unsupported method (deposit handler)", async () => {
    const { success, error } = await argent.multiCall(wallet, [
      [depositHandler, "referral", [utils.ZERO_ADDRESS]]
    ]);
    assert.isFalse(success, "referral() should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow unsupported method (withdraw handler)", async () => {
    const { success, error } = await argent.multiCall(wallet, [
      [withdrawHandler, "withdrawalFee", [true]]
    ]);
    assert.isFalse(success, "withdrawalFee() should have failed");
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
