/* global accounts */

const TestERC20 = require("../build/TestERC20");
const DSTokenBase = require("../build/DSTokenBase");
const TokenPriceProvider = require("../build/TokenPriceProvider");

const TestManager = require("../utils/test-manager");

describe("Token Price Provider", function () {
  this.timeout(10000);
  const manager = new TestManager();

  const infrastructure = accounts[0].signer;
  const priceProviderManager = accounts[1].signer;

  let deployer;
  let priceProvider;
  let erc20First;
  let erc20Second;
  let erc20ZeroDecimals;
  let baseERC20;

  before(async () => {
    deployer = manager.newDeployer();
  });

  beforeEach(async () => {
    priceProvider = await deployer.deploy(TokenPriceProvider);
    await priceProvider.addManager(priceProviderManager.address);
    erc20First = await deployer.deploy(TestERC20, {}, [infrastructure.address], 10000000, 18);
    erc20Second = await deployer.deploy(TestERC20, {}, [infrastructure.address], 10000000, 18);
    erc20ZeroDecimals = await deployer.deploy(TestERC20, {}, [infrastructure.address], 10000000, 0);
    baseERC20 = await deployer.deploy(DSTokenBase, {}, 10000000);
  });

  describe("Reading and writing token prices", () => {
    it("should set token price correctly", async () => {
      await priceProvider.from(priceProviderManager).setPrice(erc20First.contractAddress, 1800);
      const tokenPrice = await priceProvider.cachedPrices(erc20First.contractAddress);
      assert.equal(tokenPrice.toNumber(), 1800);
    });

    it("should set multiple token prices correctly", async () => {
      await priceProvider.from(priceProviderManager).setPriceForTokenList([erc20First.contractAddress, erc20Second.contractAddress], [1800, 1900]);
      const tokenPrice1 = await priceProvider.cachedPrices(erc20First.contractAddress);
      assert.equal(tokenPrice1.toNumber(), 1800);
      const tokenPrice2 = await priceProvider.cachedPrices(erc20Second.contractAddress);
      assert.equal(tokenPrice2.toNumber(), 1900);
    });

    it("should be able to get the ether value of a given amount of tokens", async () => {
      await priceProvider.from(priceProviderManager).setPrice(erc20First.contractAddress, 1800);
      const etherValue = await priceProvider.getEtherValue("15000000000000000000", erc20First.contractAddress);
      assert.isTrue(etherValue.eq(1800 * 15));
    });

    it("should be able to get the ether value for a token with no decimals property", async () => {
      await priceProvider.from(priceProviderManager).setPrice(baseERC20.contractAddress, "192297647000000000"); // Using a mock price for DGD token
      const etherValue = await priceProvider.getEtherValue(100, baseERC20.contractAddress);
      assert.equal(etherValue.toString(), "19229764700000000000");
    });

    it("should be able to get the ether value for a token with 0 decimals", async () => {
      await priceProvider.from(priceProviderManager).setPrice(erc20ZeroDecimals.contractAddress, 23000);
      const etherValue = await priceProvider.getEtherValue(100, erc20ZeroDecimals.contractAddress);
      assert.equal(etherValue.toString(), 2300000);
    });
  });
});
