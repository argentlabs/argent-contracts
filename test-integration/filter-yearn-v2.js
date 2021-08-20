/* global artifacts */

const { assert } = require("chai");
const { deployArgent } = require("../utils/argent-deployer.js");
const utils = require("../utils/utilities.js");

const Vault = artifacts.require("yVaultV2Mock");
const YearnV2Filter = artifacts.require("YearnV2Filter");
const WethFilter = artifacts.require("WethFilter");
const ERC20 = artifacts.require("TestERC20");

const amount = web3.utils.toWei("1");
const ethAmount = web3.utils.toWei("0.01");

contract("Yearn V2 Filter", (accounts) => {
  let argent;
  let wallet;

  let daiVault;
  let wethVault;
  let yvDAI;
  let yvWETH;

  before(async () => {
    argent = await deployArgent(accounts);

    // TODO: use ABI unstead of mock to avoid having both variables
    daiVault = await Vault.at("0x19D3364A399d251E894aC732651be8B0E4e85001");
    wethVault = await Vault.at("0xa9fE4601811213c340e850ea305481afF02f5b28");

    yvDAI = await ERC20.at(daiVault.address);
    yvWETH = await ERC20.at(wethVault.address);

    const yearnFilter = await YearnV2Filter.new();
    const wethFilter = await WethFilter.new();

    await argent.dappRegistry.addDapp(0, daiVault.address, yearnFilter.address);
    await argent.dappRegistry.addDapp(0, wethVault.address, yearnFilter.address);
    await argent.dappRegistry.addDapp(0, argent.WETH.address, wethFilter.address);
  });

  describe("DAI vault", () => {
    beforeEach(async () => {
      wallet = await argent.createFundedWallet({ DAI: amount });
    });

    const deposit0 = async () => argent.multiCall(wallet, [
      [argent.DAI, "approve", [daiVault.address, amount]],
      [daiVault, "deposit", []]
    ]);

    const deposit1 = async () => argent.multiCall(wallet, [
      [argent.DAI, "approve", [daiVault.address, amount]],
      [daiVault, "deposit", [amount]]
    ]);

    it("should allow deposits (0 params)", async () => {
      const { success, error } = await utils.swapAndCheckBalances({
        swap: deposit0,
        bought: yvDAI,
        sold: argent.DAI,
        wallet,
      });
      assert.isTrue(success, `deposit failed: "${error}"`);
    });

    it("should allow deposits (1 param)", async () => {
      const { success, error } = await utils.swapAndCheckBalances({
        swap: deposit1,
        bought: yvDAI,
        sold: argent.DAI,
        wallet,
      });
      assert.isTrue(success, `deposit failed: "${error}"`);
    });

    it("should allow withdrawals (0 params)", async () => {
      await deposit0();

      const { success, error } = await utils.swapAndCheckBalances({
        swap: () => argent.multiCall(wallet, [[daiVault, "withdraw", []]]),
        bought: argent.DAI,
        sold: yvDAI,
        wallet,
      });

      assert.isTrue(success, `withdrawal failed: "${error}"`);
    });

    it("should allow withdrawals (1 param)", async () => {
      await deposit1();

      const { success, error } = await utils.swapAndCheckBalances({
        swap: () => argent.multiCall(wallet, [[daiVault, "withdraw", [1]]]),
        bought: argent.DAI,
        sold: yvDAI,
        wallet,
      });

      assert.isTrue(success, `withdrawal failed: "${error}"`);
    });

    it("should not allow direct transfers to pool", async () => {
      const { success, error } = await argent.multiCall(wallet, [[argent.DAI, "transfer", [daiVault.address, amount]]]);
      assert.isFalse(success, "transfer should have failed");
      assert.equal(error, "TM: call not authorised");
    });

    it("should not allow calling unsupported method", async () => {
      const { success, error } = await argent.multiCall(wallet, [[daiVault, "setManagementFee", [1]]]);
      assert.isFalse(success, "setManagementFee() should have failed");
      assert.equal(error, "TM: call not authorised");
    });

    it("should not allow sending ETH ", async () => {
      const { success, error } = await argent.multiCall(wallet, [utils.encodeTransaction(daiVault.address, ethAmount, "0x")]);
      assert.isFalse(success, "sending ETH should have failed");
      assert.equal(error, "TM: call not authorised");
    });
  });

  describe("WETH vault", () => {
    beforeEach(async () => {
      wallet = await argent.createFundedWallet({ WETH: ethAmount });
    });

    const depositETH0 = async () => argent.multiCall(wallet, [
      [argent.WETH, "approve", [wethVault.address, ethAmount]],
      [wethVault, "deposit", []]
    ]);

    const depositETH1 = async () => argent.multiCall(wallet, [
      [argent.WETH, "approve", [wethVault.address, ethAmount]],
      [wethVault, "deposit", [ethAmount]]
    ]);

    it("should allow ETH deposits (0 params)", async () => {
      const { success, error } = await utils.swapAndCheckBalances({
        swap: depositETH0,
        bought: yvWETH,
        sold: argent.WETH,
        wallet,
      });
      assert.isTrue(success, `depositETH0 failed: "${error}"`);
    });

    it("should allow ETH deposits (1 params)", async () => {
      const { success, error } = await utils.swapAndCheckBalances({
        swap: depositETH1,
        bought: yvWETH,
        sold: argent.WETH,
        wallet,
      });
      assert.isTrue(success, `depositETH1 failed: "${error}"`);
    });

    it("should allow ETH withdrawals", async () => {
      await depositETH1();

      const { success, error } = await utils.swapAndCheckBalances({
        swap: () => argent.multiCall(wallet, [[wethVault, "withdraw", []]]),
        bought: argent.WETH,
        sold: yvWETH,
        wallet,
      });
      assert.isTrue(success, `withdrawETH failed: "${error}"`);
    });
  });
});
