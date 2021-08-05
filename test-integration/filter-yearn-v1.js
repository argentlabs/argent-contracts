/* global artifacts */

const { assert, expect } = require("chai");
const ArgentContext = require("../utils/argent-context.js");
const utils = require("../utils/utilities.js");

const YearnFilter = artifacts.require("YearnFilter");
const Vault = artifacts.require("yVault");

const amount = web3.utils.toWei("0.01");

contract("Yearn V1 Filter", (accounts) => {
  let argent;
  let wallet;
  let daiVault;
  let wethVault;

  before(async () => {
    argent = await new ArgentContext(accounts).initialise();

    daiVault = await Vault.at("0xACd43E627e64355f1861cEC6d3a6688B31a6F952");
    wethVault = await Vault.at("0xe1237aA7f535b0CC33Fd973D66cBf830354D16c7");

    const daiFilter = await YearnFilter.new(false);
    const wethFilter = await YearnFilter.new(true);

    await argent.dappRegistry.addDapp(0, daiVault.address, daiFilter.address);
    await argent.dappRegistry.addDapp(0, wethVault.address, wethFilter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet({
      DAI: web3.utils.toWei("1"),
      WETH: web3.utils.toWei("1"),
    });
  });

  const deposit = async () => argent.multiCall(wallet, [
    [argent.DAI, "approve", [daiVault.address, amount]],
    [daiVault, "deposit", [amount]]
  ]);

  const depositETH = async () => argent.multiCall(wallet, [
    [wethVault, "depositETH", [], amount]
  ]);

  const withdraw = async ({ all }) => {
    const balance = await daiVault.balanceOf(wallet.address);
    expect(balance).to.be.gt.BN(0);
    return argent.multiCall(wallet, [
      all ? [daiVault, "withdrawAll"] : [daiVault, "withdraw", [balance.toString()]]
    ]);
  };

  const withdrawETH = async ({ all }) => {
    const balance = await wethVault.balanceOf(wallet.address);
    expect(balance).to.be.gt.BN(0);
    return argent.multiCall(wallet, [
      all ? [wethVault, "withdrawAllETH"] : [wethVault, "withdrawETH", [balance.toString()]]
    ]);
  };

  it("should allow deposits", async () => {
    const { success, error } = await deposit();
    assert.isTrue(success, `deposit failed: "${error}"`);
  });

  it("should allow ETH deposits", async () => {
    const { success, error } = await depositETH();
    assert.isTrue(success, `depositETH failed: "${error}"`);
  });

  it("should allow withdrawals (withdraw(amount))", async () => {
    await deposit();
    const { success, error } = await withdraw({ all: false });
    assert.isTrue(success, `withdraw(amount) failed: "${error}"`);
  });

  it("should allow withdrawals (withdrawETH(amount))", async () => {
    await depositETH();
    const { success, error } = await withdrawETH({ all: false });
    assert.isTrue(success, `withdrawETH(amount) failed: "${error}"`);
  });

  it("should allow withdrawals (withdrawAll())", async () => {
    await deposit();
    const { success, error } = await withdraw({ all: true });
    assert.isTrue(success, `withdrawAll() failed: "${error}"`);
  });

  it("should allow withdrawals (withdrawAllETH())", async () => {
    await depositETH();
    const { success, error } = await withdrawETH({ all: true });
    assert.isTrue(success, `withdrawAllETH() failed: "${error}"`);
  });

  it("should not allow direct transfers to pool", async () => {
    const { success, error } = await argent.multiCall(wallet, [
      [argent.WETH, "transfer", [daiVault.address, amount]]
    ]);
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow unsupported method", async () => {
    const { success, error } = await argent.multiCall(wallet, [[daiVault, "earn"]]);
    assert.isFalse(success, "earn() should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH to non-weth pool", async () => {
    const { success, error } = await argent.multiCall(wallet, [utils.encodeTransaction(daiVault.address, amount, "0x")]);
    assert.isFalse(success, "sending ETH should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should allow sending ETH to weth pool", async () => {
    const { success, error } = await argent.multiCall(wallet, [utils.encodeTransaction(wethVault.address, amount, "0x")]);
    assert.isTrue(success, `sending ETH failed: "${error}"`);
  });
});
