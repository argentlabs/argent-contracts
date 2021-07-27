/* global artifacts */

const ArgentContext = require("../utils/argent-context.js");

const BPool = artifacts.require("BPool");
const BalancerFilter = artifacts.require("BalancerFilter");

const amount = web3.utils.toWei("1");

contract("Balancer Filter", (accounts) => {
  let argent, wallet;
  let pool;

  before(async () => {
    argent = await new ArgentContext(accounts).initialize();

    pool = await BPool.at("0x1eff8af5d577060ba4ac8a29a13525bb0ee2a3d5");

    const filter = await BalancerFilter.new();
    await argent.dappRegistry.addDapp(0, pool.address, filter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet({ WETH: "1" });
  });

  const deposit = async () => argent.multiCall(wallet, [
    [argent.WETH, "approve", [pool.address, amount]],
    [pool, "joinswapExternAmountIn", [argent.WETH.address, amount, 1]]
  ]);

  it("should allow deposits", async () => {
    const { success, error } = await deposit();
    assert.isTrue(success, `deposit failed: "${error}"`);
  });

  it("should allow withdrawals", async () => {
    await deposit();
    const bpt = await pool.balanceOf(wallet.address);
    const { success, error } = await argent.multiCall(wallet, [
      [pool, "approve", [pool.address, bpt.toString()]],
      [pool, "exitswapExternAmountOut", [argent.WETH.address, web3.utils.toWei("0.1"), bpt.toString()]]
    ]);
    assert.isTrue(success, `withdrawal failed: "${error}"`);
  });
});
