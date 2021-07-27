/* global artifacts */

const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");
const ArgentContext = require("../utils/argent-context.js");
const utils = require("../utils/utilities.js");

const AaveV1LendingPoolFilter = artifacts.require("AaveV1LendingPoolFilter");
const OnlyApproveFilter = artifacts.require("OnlyApproveFilter");
const AaveV1ATokenFilter = artifacts.require("AaveV1ATokenFilter");
const IAaveV1LendingPool = artifacts.require("IAaveV1LendingPool");
const IAToken = artifacts.require("IAToken");

const { assert, expect } = chai;
chai.use(bnChai(BN));

const AAVE_ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

contract("AaveV1 Filter", (accounts) => {
  let argent, wallet;

  let aaveLendingPoolCore;
  let aaveLendingPool;
  let aToken;
  let aUSDCToken;

  before(async () => {
    argent = await new ArgentContext(accounts).initialize();

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
    wallet = await argent.createFundedWallet({ USDC: "100" });
  });

  describe("deposit", () => {
    it("should allow deposits of ETH on behalf of wallet", async () => {
      const transactions = utils.encodeCalls([
        [aaveLendingPool, "deposit", [AAVE_ETH_TOKEN, 1000, ""], 1000]
      ]);

      const receipt = await argent.multiCallRaw(wallet, transactions);

      const { success, error } = utils.parseRelayReceipt(receipt);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const event = await utils.getEvent(receipt, aaveLendingPool, "Deposit");
      assert.equal(event.args._reserve, AAVE_ETH_TOKEN);
      assert.equal(event.args._user, wallet.address);
      assert.equal(event.args._amount, 1000);

      const balance = await aToken.balanceOf(wallet.address);
      expect(balance).to.eq.BN(1000);
    });

    it("should allow deposits of ERC20 on behalf of wallet", async () => {
      expect(await argent.USDC.balanceOf(wallet.address)).to.gte.BN(1000);

      const transactions = utils.encodeCalls([
        [argent.USDC, "approve", [aaveLendingPoolCore, 1000]],
        [aaveLendingPool, "deposit", [argent.USDC.address, 1000, ""]]
      ]);

      const receipt = await argent.multiCallRaw(wallet, transactions);

      const { success, error } = utils.parseRelayReceipt(receipt);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const event = await utils.getEvent(receipt, aaveLendingPool, "Deposit");
      assert.equal(event.args._reserve, argent.USDC.address);
      assert.equal(event.args._user, wallet.address);
      assert.equal(event.args._amount, 1000);

      const balance = await aUSDCToken.balanceOf(wallet.address);
      expect(balance).to.eq.BN(1000);
    });

    it("should not allow calling forbidden lending pool methods", async () => {
      const transactions = utils.encodeCalls([
        [aaveLendingPool, "borrow", [aToken.address, 10, 0, 0]]
      ]);

      const receipt = await argent.multiCallRaw(wallet, transactions);

      const { success, error } = utils.parseRelayReceipt(receipt);
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

      // Redeem the 1000 wei tokens
      const transactions = utils.encodeCalls([
        [aToken, "redeem", [1000], 0]
      ]);

      const receipt = await argent.multiCallRaw(wallet, transactions);

      const { success, error } = utils.parseRelayReceipt(receipt);
      assert.isTrue(success, `redeem failed: "${error}"`);

      const event = await utils.getEvent(receipt, aToken, "Redeem");
      assert.equal(event.args._from, wallet.address);
      assert.equal(event.args._value, 1000);
    });

    it("should allow redeem of ERC20 to wallet", async () => {
      expect(await argent.USDC.balanceOf(wallet.address)).to.gte.BN(1000);

      await argent.multiCall(wallet, [
        [argent.USDC, "approve", [aaveLendingPoolCore, 1000]],
        [aaveLendingPool, "deposit", [argent.USDC.address, 1000, ""]]
      ]);

      // Redeem the 1000 aUSDC tokens
      const transactions = utils.encodeCalls([
        [aUSDCToken, "redeem", [1000], 0]
      ]);

      const receipt = await argent.multiCallRaw(wallet, transactions);

      const { success, error } = utils.parseRelayReceipt(receipt);
      assert.isTrue(success, `redeem failed: "${error}"`);

      const event = await utils.getEvent(receipt, aUSDCToken, "Redeem");
      assert.equal(event.args._from, wallet.address);
      assert.equal(event.args._value, 1000);
    });
  });
});
