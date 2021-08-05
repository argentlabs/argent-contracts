/* global artifacts */

const { assert, expect } = require("chai");
const ArgentContext = require("../utils/argent-context.js");
const utils = require("../utils/utilities.js");

const AaveV1LendingPoolFilter = artifacts.require("AaveV1LendingPoolFilter");
const OnlyApproveFilter = artifacts.require("OnlyApproveFilter");
const AaveV1ATokenFilter = artifacts.require("AaveV1ATokenFilter");
const IAaveV1LendingPool = artifacts.require("IAaveV1LendingPool");
const IAToken = artifacts.require("IAToken");

const AAVE_ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

contract("Aave V1 Filter", (accounts) => {
  let argent;
  let wallet;

  let aaveLendingPoolCore;
  let aaveLendingPool;
  let aToken;
  let aUSDCToken;

  before(async () => {
    argent = await new ArgentContext(accounts).initialise();

    // Wire up AaveV1
    aaveLendingPoolCore = "0x3dfd23A6c5E8BbcFc9581d2E864a68feb6a076d3";
    aaveLendingPool = await IAaveV1LendingPool.at("0x398eC7346DcD622eDc5ae82352F02bE94C62d119");
    aToken = await IAToken.at("0x3a3A65aAb0dd2A17E3F1947bA16138cd37d08c04");
    aUSDCToken = await IAToken.at("0x9ba00d6856a4edf4665bca2c2309936572473b7e");

    const filter = await AaveV1LendingPoolFilter.new();
    const aTokenFilter = await AaveV1ATokenFilter.new();
    const approveFilter = await OnlyApproveFilter.new();

    await argent.dappRegistry.addDapp(0, aaveLendingPoolCore, approveFilter.address);
    await argent.dappRegistry.addDapp(0, aaveLendingPool.address, filter.address);
    await argent.dappRegistry.addDapp(0, aToken.address, aTokenFilter.address);
    await argent.dappRegistry.addDapp(0, aUSDCToken.address, aTokenFilter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet({ USDC: "1000000" }); // 1 USDC
  });

  describe("deposit", () => {
    it("should allow deposits of ETH on behalf of wallet", async () => {
      const { success, error, receipt } = await argent.multiCall(wallet, [
        [aaveLendingPool, "deposit", [AAVE_ETH_TOKEN, 1000, ""], 1000]
      ]);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const event = await utils.getEvent(receipt, aaveLendingPool, "Deposit");
      assert.equal(event.args._reserve, AAVE_ETH_TOKEN);
      assert.equal(event.args._user, wallet.address);
      assert.equal(event.args._amount, 1000);

      const balance = await aToken.balanceOf(wallet.address);
      expect(balance).to.be.eq.BN(1000);
    });

    it("should allow deposits of ERC20 on behalf of wallet", async () => {
      expect(await argent.USDC.balanceOf(wallet.address)).to.be.gte.BN(1000);

      const { success, error, receipt } = await argent.multiCall(wallet, [
        [argent.USDC, "approve", [aaveLendingPoolCore, 1000]],
        [aaveLendingPool, "deposit", [argent.USDC.address, 1000, ""]]
      ]);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const event = await utils.getEvent(receipt, aaveLendingPool, "Deposit");
      assert.equal(event.args._reserve, argent.USDC.address);
      assert.equal(event.args._user, wallet.address);
      assert.equal(event.args._amount, 1000);

      const balance = await aUSDCToken.balanceOf(wallet.address);
      expect(balance).to.be.eq.BN(1000);
    });

    it("should not allow calling forbidden lending pool methods", async () => {
      const { success, error } = await argent.multiCall(wallet, [
        [aaveLendingPool, "borrow", [aToken.address, 10, 0, 0]]
      ]);
      assert.isFalse(success, "borrow should have failed");
      assert.equal(error, "TM: call not authorised");
    });
  });

  describe("redeem", () => {
    it("should allow redeem of ETH to wallet", async () => {
      // Fund the wallet with 1000 wei and deposit them to Aave
      await argent.multiCall(wallet, [
        [aaveLendingPool, "deposit", [AAVE_ETH_TOKEN, 1000, ""], 1000]
      ]);

      const { success, error, receipt } = await argent.multiCall(wallet, [
        [aToken, "redeem", [1000], 0]
      ]);
      assert.isTrue(success, `redeem failed: "${error}"`);

      const event = await utils.getEvent(receipt, aToken, "Redeem");
      assert.equal(event.args._from, wallet.address);
      assert.equal(event.args._value, 1000);
    });

    it("should allow redeem of ERC20 to wallet", async () => {
      expect(await argent.USDC.balanceOf(wallet.address)).to.be.gte.BN(1000);

      await argent.multiCall(wallet, [
        [argent.USDC, "approve", [aaveLendingPoolCore, 1000]],
        [aaveLendingPool, "deposit", [argent.USDC.address, 1000, ""]]
      ]);

      const { success, error, receipt } = await argent.multiCall(wallet, [
        [aUSDCToken, "redeem", [1000], 0]
      ]);
      assert.isTrue(success, `redeem failed: "${error}"`);

      const event = await utils.getEvent(receipt, aUSDCToken, "Redeem");
      assert.equal(event.args._from, wallet.address);
      assert.equal(event.args._value, 1000);
    });
  });
});
