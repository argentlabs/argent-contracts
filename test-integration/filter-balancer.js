/* global artifacts */

const utils = require("../utils/utilities.js");
const { deployArgent } = require("../utils/argent-deployer.js");

const BPool = artifacts.require("BPool");
const BalancerFilter = artifacts.require("BalancerFilter");

const amount = web3.utils.toWei("1");

contract("Balancer Filter", (accounts) => {
  let argent;
  let wallet;
  let pool;

  before(async () => {
    argent = await deployArgent(accounts);

    pool = await BPool.at("0x1eff8af5d577060ba4ac8a29a13525bb0ee2a3d5");
    const filter = await BalancerFilter.new();
    await argent.dappRegistry.addDapp(0, pool.address, filter.address);
  });

  beforeEach(async () => {
    wallet = await argent.createFundedWallet({ WETH: amount });
  });

  const deposit = async () => argent.multiCall(wallet, [
    [argent.WETH, "approve", [pool.address, amount]],
    [pool, "joinswapExternAmountIn", [argent.WETH.address, amount, 1]]
  ]);

  const withdraw = async ({ fixedOutAmount }) => {
    const bpt = await pool.balanceOf(wallet.address);
    return argent.multiCall(wallet, [
      [pool, "approve", [pool.address, bpt.toString()]],
      (fixedOutAmount ? [
        pool, "exitswapExternAmountOut", [argent.WETH.address, web3.utils.toWei("0.1"), bpt.toString()]
      ] : [
        pool, "exitswapPoolAmountIn", [argent.WETH.address, bpt.toString(), 1]
      ])
    ]);
  };

  it("should allow deposits", async () => {
    const { success, error } = await utils.swapAndCheckBalances({
      swap: deposit,
      bought: pool,
      sold: argent.WETH,
      wallet,
    });
    assert.isTrue(success, `deposit failed: "${error}"`);
  });

  it("should allow withdrawals (exitswapExternAmountOut)", async () => {
    await deposit();
    const { success, error } = await withdraw({ fixedOutAmount: true });
    assert.isTrue(success, `exitswapExternAmountOut failed: "${error}"`);
  });

  it("should allow withdrawals (exitswapPoolAmountIn)", async () => {
    await deposit();
    const { success, error } = await withdraw({ fixedOutAmount: false });
    assert.isTrue(success, `exitswapPoolAmountIn failed: "${error}"`);
  });

  it("should not allow direct transfers to pool", async () => {
    const { success, error } = await argent.multiCall(wallet, [
      [argent.WETH, "transfer", [pool.address, amount]],
    ]);
    assert.isFalse(success, "transfer should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow unsupported method", async () => {
    const { success, error } = await argent.multiCall(wallet, [
      [pool, "swapExactAmountIn", [argent.WETH.address, web3.utils.toWei("0.1"), argent.DAI.address, 1, web3.utils.toWei("10000")]]
    ]);
    assert.isFalse(success, "swap should have failed");
    assert.equal(error, "TM: call not authorised");
  });

  it("should not allow sending ETH to pool", async () => {
    const { success, error } = await argent.multiCall(wallet, [utils.encodeTransaction(pool.address, web3.utils.toWei("0.01"), "0x")]);
    assert.isFalse(success, "sending ETH should have failed");
    assert.equal(error, "TM: call not authorised");
  });
});
