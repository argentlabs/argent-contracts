/* global artifacts */

const utils = require("../utils/utilities.js");
const { deployArgent } = require("../utils/argent-deployer.js");

const LidoFilter = artifacts.require("LidoFilter");
const CurveFilter = artifacts.require("CurveFilter");
const ILido = artifacts.require("ILido");
const ICurvePool = artifacts.require("ICurvePool");

contract("Lido Filter", (accounts) => {
  let argent;
  let wallet;
  let lido;
  let curve;

  before(async () => {
    argent = await deployArgent(accounts);

    lido = await ILido.at("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84");
    curve = await ICurvePool.at("0xdc24316b9ae028f1497c275eb9192a3ea0f67022");

    const lidoFilter = await LidoFilter.new();
    const curveFilter = await CurveFilter.new();

    await argent.dappRegistry.addDapp(0, lido.address, lidoFilter.address);
    await argent.dappRegistry.addDapp(0, curve.address, curveFilter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet();
  });

  describe("Lido staking", () => {
    it("should allow staking from wallet via fallback", async () => {
      const { success, error } = await argent.multiCall(wallet, [utils.encodeTransaction(lido.address, 100, "0x")]);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const walletBalance = await lido.balanceOf(wallet.address);
      assert.closeTo(walletBalance.toNumber(), 99, 1);
    });

    it("should allow staking from wallet via submit", async () => {
      const { success, error } = await argent.multiCall(wallet, [
        [lido, "submit", [accounts[5]], 100]
      ]);
      assert.isTrue(success, `deposit failed: "${error}"`);

      const walletBalance = await lido.balanceOf(wallet.address);
      assert.closeTo(walletBalance.toNumber(), 99, 1);
    });
  });

  describe("Selling via CurvePool", () => {
    beforeEach(async () => {
      // Stake some funds to use to test selling
      await argent.multiCall(wallet, [
        [lido, "submit", [accounts[5]], 100]
      ]);
    });

    it("should allow selling stETH via Curve", async () => {
      const before = await utils.getBalance(wallet.address);

      const transactions = [
        [lido, "approve", [curve.address, 99]],
        [curve, "exchange", [1, 0, 99, 1]],
      ];
      const { success, error } = await argent.multiCall(wallet, transactions, { gasPrice: 0 });

      assert.isTrue(success, `exchange failed: "${error}"`);

      // Check ETH was received
      const after = await utils.getBalance(wallet.address);
      assert.closeTo(after.sub(before).toNumber(), 96, 3);

      // Check only dust stETH left
      const walletBalance = await lido.balanceOf(wallet.address);
      assert.closeTo(walletBalance.toNumber(), 1, 1);
    });
  });
});
