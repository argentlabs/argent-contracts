/* global artifacts */
const KyberNetwork = artifacts.require("KyberNetworkTest");
const ERC20 = artifacts.require("TestERC20");

const chai = require("chai");
const BN = require("bn.js");
const bnChai = require("bn-chai");

const { expect } = chai;
chai.use(bnChai(BN));

const { ETH_TOKEN, getBalance } = require("../utils/utilities.js");

const ERC20_SUPPLY = 10000000;
const ERC20_DECIMALS = 18;
const ERC20_RATE = 51 * 10 ** 13; // 1 ERC20 = 0.00051 ETH

contract("KyberNetwork", (accounts) => {
  const trader = accounts[1];

  let erc20;
  let kyber;

  beforeEach(async () => {
    kyber = await KyberNetwork.new();
    erc20 = await ERC20.new([kyber.address], ERC20_SUPPLY, ERC20_DECIMALS);
    await kyber.addToken(erc20.address, ERC20_RATE, ERC20_DECIMALS);
  });

  it("should return the expected rate for a token pair", async () => {
    const rate = await kyber.getExpectedRate(erc20.address, ETH_TOKEN, 1);
    assert.equal(rate[0], ERC20_RATE, "rate should be correct");
  });

  it("should exchange ETH for ERC20", async () => {
    const beforeERC20 = await erc20.balanceOf(trader);
    const beforeETH = await getBalance(trader);
    // trader should have no ERC20
    expect(beforeERC20).to.be.zero;
    await kyber.trade(ETH_TOKEN, 10000, erc20.address, trader,
      new BN("10000000000000000000000"), 1, "0x0000000000000000000000000000000000000000", { value: 10000, from: trader });
    const afterERC20 = await erc20.balanceOf(trader);
    const afterETH = await getBalance(trader);
    // trader should have exchanged 10000 wei
    expect(beforeETH.sub(afterETH)).to.be.gt.BN(10000);
    // trader should have received ERC20
    expect(afterERC20).to.be.gt.BN(0);
  });

  it("should exchange ERC20 for ETH", async () => {
    // provision ERC20 to trader
    await kyber.trade(
      ETH_TOKEN,
      new BN("1000000000000000000"),
      erc20.address,
      trader,
      new BN("10000000000000000000000"),
      1,
      "0x0000000000000000000000000000000000000000",
      { value: new BN("1000000000000000000") },
    );
    const beforeERC20 = await erc20.balanceOf(trader);
    const beforeETH = await getBalance(trader);
    // trader should have some ERC20
    expect(beforeERC20).to.be.gt.BN(0);
    // exchange ERC20
    const srcAmount = beforeERC20.div(new BN(2));
    await erc20.approve(kyber.address, srcAmount, { from: trader });
    await kyber.trade(erc20.address, srcAmount, ETH_TOKEN, trader,
      new BN("10000000000000000000000"), 1, "0x0000000000000000000000000000000000000000", { from: trader });
    const afterERC20 = await erc20.balanceOf(trader);
    const afterETH = await getBalance(trader);
    // trader should have exchanged ERC20
    expect(beforeERC20.sub(afterERC20)).to.eq.BN(srcAmount);
    // trader should have received wei
    expect(afterETH.sub(beforeETH)).to.be.gt.BN(0);
  });
});
