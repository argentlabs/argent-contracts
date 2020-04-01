/* global accounts */

const ERC20 = require("../build/TestERC20");
const KyberNetwork = require("../build/KyberNetworkTest");
const TokenPriceProvider = require("../build/TokenPriceProvider");

const TestManager = require("../utils/test-manager");

describe("Token Price Provider", () => {
  const manager = new TestManager();

  const infrastructure = accounts[0].signer;
  const priceProviderManager = accounts[1].signer;

  let deployer;
  let kyber;
  let priceProvider;
  let erc20First;
  let erc20Second;

  before(async () => {
    deployer = manager.newDeployer();
    kyber = await deployer.deploy(KyberNetwork);
  });

  beforeEach(async () => {
    priceProvider = await deployer.deploy(TokenPriceProvider, {}, kyber.contractAddress);
    await priceProvider.addManager(priceProviderManager.address);
    erc20First = await deployer.deploy(ERC20, {}, [infrastructure.address], 10000000, 18);
    erc20Second = await deployer.deploy(ERC20, {}, [infrastructure.address], 10000000, 18);
  });

  it("should be able to set the Kyber network contract", async () => {
    const kyberNew = await deployer.deploy(KyberNetwork);
    await priceProvider.from(priceProviderManager).setKyberNetwork(kyberNew.contractAddress);
    const kyberContract = await priceProvider.kyberNetwork();
    assert.equal(kyberNew.contractAddress, kyberContract);
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
  });
});
