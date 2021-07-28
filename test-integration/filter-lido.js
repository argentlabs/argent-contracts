/* global artifacts */

require("chai");
const ethers = require("ethers");
const utils = require("../utils/utilities.js");
const ArgentContext = require("../utils/argent-context.js");

const LidoFilter = artifacts.require("LidoFilter");
const CurveFilter = artifacts.require("CurveFilter");
const ILido = artifacts.require("ILido");
const ICurvePool = artifacts.require("ICurvePool");

contract("Lido Filter", (accounts) => {
  let argent, wallet;
  let lido, curve;

  before(async () => {
    argent = await new ArgentContext(accounts).initialize();

    lido = await ILido.at("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84");
    const lidoFilter = await LidoFilter.new();
    await argent.dappRegistry.addDapp(0, lido.address, lidoFilter.address);

    curve = await ICurvePool.at("0xdc24316b9ae028f1497c275eb9192a3ea0f67022");
    const curveFilter = await CurveFilter.new();
    await argent.dappRegistry.addDapp(0, curve.address, curveFilter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet();
  });

  describe("Lido staking", () => {
    it("should allow staking from wallet via fallback", async () => {
      const transaction = utils.encodeTransaction(lido.address, 100, "0x");

      const receipt = await argent.multiCallRaw(wallet, [transaction]);
      const { success, error } = utils.parseRelayReceipt(receipt);
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
      let data = lido.contract.methods.approve(curve.address, 99).encodeABI();
      const lidoTransaction = utils.encodeTransaction(lido.address, 0, data);
      data = curve.contract.methods.exchange(1, 0, 99, 1).encodeABI();
      const curveTransaction = utils.encodeTransaction(curve.address, 0, data);
      const transactions = [lidoTransaction, curveTransaction];

      const before = await utils.getBalance(wallet.address);
      const txReceipt = await argent.manager.relay(
        argent.module,
        "multiCall",
        [wallet.address, transactions],
        wallet,
        [argent.owner],
        0,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero);
      console.log("Gas to exchange stETH for ETH", txReceipt.gasUsed);

      const { success, error } = utils.parseRelayReceipt(txReceipt);
      assert.isTrue(success, `exchange failed: "${error}"`);

      // const event = await utils.getEvent(txReceipt, curve, "TokenExchange");
      // assert.equal(event.args.tokens_sold, 99); // Sold stETH
      // assert.closeTo(new BN(event.args.tokens_bought).toNumber(), new BN(96).toNumber(), 3); // Got ETH
      // Check ETH was received
      const after = await utils.getBalance(wallet.address);
      assert.closeTo(after.sub(before).toNumber(), 96, 3);

      // Check only dust stETH left
      const walletBalance = await lido.balanceOf(wallet.address);
      assert.closeTo(walletBalance.toNumber(), 1, 1);
    });
  });
});
