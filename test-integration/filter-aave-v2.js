/* global artifacts */

const { assert } = require("chai");
const { deployArgent } = require("../utils/argent-deployer.js");
const utils = require("../utils/utilities.js");

const AaveV2Filter = artifacts.require("AaveV2Filter");
const AaveV2LendingPool = artifacts.require("AaveV2LendingPoolMock");
const ERC20 = artifacts.require("TestERC20");

const amount = web3.utils.toWei("1");

contract("Aave V2 Filter", (accounts) => {
  let argent;
  let wallet;

  let pool;
  let aDai;

  before(async () => {
    argent = await deployArgent(accounts);

    pool = await AaveV2LendingPool.at("0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9");
    aDai = await ERC20.at("0x028171bCA77440897B824Ca71D1c56caC55b68A3");

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

  it("should allow deposits on behalf of wallet", async () => {
    const { success, error } = await utils.swapAndCheckBalances({
      swap: () => deposit(wallet.address),
      bought: aDai,
      sold: argent.DAI,
      wallet,
    });
    assert.isTrue(success, `deposit failed: "${error}"`);
  });

  it("should not allow deposits on behalf of non-wallet", async () => {
    const { success, error } = await deposit(argent.infrastructure);
    assert.isFalse(success, "deposit should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should allow withdrawals to wallet", async () => {
    await deposit(wallet.address);

    const { success, error } = await utils.swapAndCheckBalances({
      swap: () => withdraw(wallet.address),
      bought: argent.DAI,
      sold: aDai,
      wallet,
    });
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
