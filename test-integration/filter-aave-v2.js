/* global artifacts */

const { assert } = require("chai");
const ArgentContext = require("../utils/argent-context.js");
const utils = require("../utils/utilities.js");

const AaveV2Filter = artifacts.require("AaveV2Filter");
const AaveV2LendingPool = artifacts.require("AaveV2LendingPoolMock");

const amount = web3.utils.toWei("1");

contract("Aave V2 Filter", (accounts) => {
  let argent;
  let wallet;
  let pool;

  before(async () => {
    argent = await new ArgentContext(accounts).initialize();

    pool = await AaveV2LendingPool.at("0xC6845a5C768BF8D7681249f8927877Efda425baf");

    const filter = await AaveV2Filter.new();
    await argent.dappRegistry.addDapp(0, pool.address, filter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet({ DAI: amount });
  });

  const deposit = async (beneficiary) => argent.multiCall(wallet, [
    [argent.DAI, "approve", [pool.address, amount]],
    [pool, "deposit", [argent.DAI.address, amount, beneficiary, 0]]
  ]);

  const withdraw = async (beneficiary) => argent.multiCall(wallet, [
    [pool, "withdraw", [argent.DAI.address, amount, beneficiary]]
  ]);

  it.skip("should allow deposits on behalf of wallet", async () => {
    const { success, error } = await deposit(wallet.address);
    assert.isTrue(success, `deposit failed: "${error}"`);
  });

  it("should not allow deposits on behalf of non-wallet", async () => {
    const { success, error } = await deposit(argent.infrastructure);
    assert.isFalse(success, "deposit should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it.skip("should allow withdrawals to wallet", async () => {
    await deposit(wallet.address);
    const { success, error } = await withdraw(wallet.address);
    assert.isTrue(success, `withdraw failed: "${error}"`);
  });

  it("should not allow withdrawals to non-wallet", async () => {
    await deposit(wallet.address);
    const { success, error } = await withdraw(argent.infrastructure);
    assert.isFalse(success, "withdraw should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow direct transfers to lending pool", async () => {
    const { success, error } = await argent.multiCall(wallet, [
      [argent.DAI, "transfer", [pool.address, amount]],
    ]);
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow calling forbidden lending pool methods", async () => {
    const { success, error } = await argent.multiCall(wallet, [
      [pool, "borrow", [argent.DAI.address, amount, 0, 0, wallet.address]]
    ]);
    assert.isFalse(success, "borrow should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH to lending pool", async () => {
    const { success, error } = await argent.multiCall(wallet, [utils.encodeTransaction(pool.address, web3.utils.toWei("0.01"), "0x")]);
    assert.isFalse(success, "sending ETH should have failed");
    assert.equal(error, "TM: call not authorised");
  });
});
