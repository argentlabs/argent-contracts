/* global artifacts */

const ArgentContext = require("../utils/argent-context.js");

const BPool = artifacts.require("BPool");
const BalancerFilter = artifacts.require("BalancerFilter");

contract("Balancer Filter", (accounts) => {
  let argent, wallet;
  let pool;

  before(async () => {
    argent = await new ArgentContext(accounts).initialize();

    pool = await BPool.at("0x1eff8af5d577060ba4ac8a29a13525bb0ee2a3d5");

    const balancerFilter = await BalancerFilter.new();
    await argent.dappRegistry.addDapp(0, pool.address, balancerFilter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet();
  });

  it("should allow deposits", async () => {
    const amount = web3.utils.toWei("10");
    const { success, error } = await argent.multiCall(wallet, [
      // todo
    ]);
    assert.isTrue(success, `deposit failed: "${error}"`);
  });

  it("should allow withdrawals", async () => {
    const { success, error } = await argent.multiCall(wallet, [
      // todo
    ]);
    assert.isTrue(success, `withdrawal failed: "${error}"`);
  });
});
