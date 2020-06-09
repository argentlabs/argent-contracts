/* global accounts */
const ethers = require("ethers");

const KyberNetwork = require("../build/KyberNetworkTest");
const ERC20 = require("../build/TestERC20");

const TestManager = require("../utils/test-manager");
const { ETH_TOKEN } = require("../utils/utilities.js");

const ERC20_SUPPLY = 10000000;
const ERC20_DECIMALS = 18;
const ERC20_RATE = 51 * 10 ** 13; // 1 ERC20 = 0.00051 ETH

describe("Kyber", function () {
  this.timeout(10000);

  const manager = new TestManager();

  const trader = accounts[1].signer;

  let deployer;
  let erc20;
  let kyber;

  beforeEach(async () => {
    deployer = manager.newDeployer();
    kyber = await deployer.deploy(KyberNetwork);
    erc20 = await deployer.deploy(ERC20, {}, [kyber.contractAddress], ERC20_SUPPLY, ERC20_DECIMALS);
    await kyber.addToken(erc20.contractAddress, ERC20_RATE, ERC20_DECIMALS);
  });

  it("should return the expected rate for a token pair", async () => {
    const rate = await kyber.getExpectedRate(erc20.contractAddress, ETH_TOKEN, 1);
    assert.equal(rate[0], ERC20_RATE, "rate should be correct");
  });

  it("should exchange ETH for ERC20", async () => {
    const beforeERC20 = await erc20.balanceOf(trader.address);
    const beforeETH = await deployer.provider.getBalance(trader.address);
    assert.equal(beforeERC20.toNumber(), 0, "trader should have no ERC20");
    await kyber.from(trader).trade(ETH_TOKEN, 10000, erc20.contractAddress, trader.address,
      ethers.utils.bigNumberify("10000000000000000000000"), 1, "0x0000000000000000000000000000000000000000", { value: 10000 });
    const afterERC20 = await erc20.balanceOf(trader.address);
    const afterETH = await deployer.provider.getBalance(trader.address);
    assert.equal(beforeETH.sub(afterETH).gt(10000), true, "trader should have exchanged 10000 wei");
    assert.equal(afterERC20.gt(0), true, "trader should have received ERC20");
  });

  it("should exchange ERC20 for ETH", async () => {
    // provision ERC20 to trader
    await kyber.trade(
      ETH_TOKEN,
      ethers.utils.bigNumberify("1000000000000000000"),
      erc20.contractAddress,
      trader.address,
      ethers.utils.bigNumberify("10000000000000000000000"),
      1,
      "0x0000000000000000000000000000000000000000",
      { value: ethers.utils.bigNumberify("1000000000000000000") },
    );
    const beforeERC20 = await erc20.balanceOf(trader.address);
    const beforeETH = await deployer.provider.getBalance(trader.address);
    assert.equal(beforeERC20 > 0, true, "trader should have some ERC20");
    // exchange ERC20
    const srcAmount = beforeERC20.div(ethers.utils.bigNumberify(2));
    await erc20.from(trader).approve(kyber.contractAddress, srcAmount);
    await kyber.from(trader).trade(erc20.contractAddress, srcAmount, ETH_TOKEN, trader.address,
      ethers.utils.bigNumberify("10000000000000000000000"), 1, "0x0000000000000000000000000000000000000000");
    const afterERC20 = await erc20.balanceOf(trader.address);
    const afterETH = await deployer.provider.getBalance(trader.address);
    assert.equal(beforeERC20.sub(afterERC20).eq(srcAmount), true, "trader should have exchanged ERC20");
    assert.equal(afterETH.sub(beforeETH).gt(0), true, "trader should have received wei");
  });
});
