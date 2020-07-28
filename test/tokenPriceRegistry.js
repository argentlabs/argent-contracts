/* global accounts */

const TokenPriceRegistry = require("../build/TokenPriceRegistry");
const ERC20 = require("../build/TestERC20");
const TestManager = require("../utils/test-manager");

describe("TokenPriceRegistry", function () {
  this.timeout(100000);
  const testManager = new TestManager();
  const deployer = testManager.newDeployer();
  const owner = accounts[0].signer;
  const manager = accounts[1].signer;

  let tokenAddress;
  let tokenPriceRegistry;

  before(async () => {
    tokenAddress = (await (await deployer.deploy(ERC20, {}, [], 1, 18)).contractAddress);
  });

  beforeEach(async () => {
    tokenPriceRegistry = await deployer.deploy(TokenPriceRegistry);
    await tokenPriceRegistry.addManager(manager);
    await tokenPriceRegistry.setMinPriceUpdatePeriod(3600);
  });

  describe("Price changes", () => {
    it("lets managers change price after security period", async () => {
      await tokenPriceRegistry.from(manager).setPriceForTokenList([tokenAddress], [111111]);
      const beforePrice = await tokenPriceRegistry.getTokenPrice(tokenAddress);
      assert.equal(beforePrice.toString(), "111111");
      await testManager.increaseTime(3601);
      await tokenPriceRegistry.from(manager).setPriceForTokenList([tokenAddress], [222222]);
      const afterPrice = await tokenPriceRegistry.getTokenPrice(tokenAddress);
      assert.equal(afterPrice.toString(), "222222");
    });
    it("does not let managers change price with invalid array lengths", async () => {
      await assert.revertWith(tokenPriceRegistry.from(manager).setPriceForTokenList([tokenAddress], [222222, 333333]), "TPS: Array length mismatch");
    });
    it("does not let managers change price before security period", async () => {
      await tokenPriceRegistry.from(manager).setPriceForTokenList([tokenAddress], [111111]);
      await testManager.increaseTime(3500);
      await assert.revertWith(tokenPriceRegistry.from(manager).setPriceForTokenList([tokenAddress], [222222]), "TPS: Price updated too early");
    });
    it("lets the owner change security period", async () => {
      await tokenPriceRegistry.from(manager).setPriceForTokenList([tokenAddress], [111111]);
      await testManager.increaseTime(1600);
      await assert.revertWith(tokenPriceRegistry.from(manager).setPriceForTokenList([tokenAddress], [222222]), "TPS: Price updated too early");
      await tokenPriceRegistry.from(owner).setMinPriceUpdatePeriod(0);
      await tokenPriceRegistry.from(manager).setPriceForTokenList([tokenAddress], [222222]);
      const afterPrice = await tokenPriceRegistry.getTokenPrice(tokenAddress);
      assert.equal(afterPrice.toString(), "222222");
    });
  });

  describe("Tradable status changes", () => {
    it("lets the owner change tradable status", async () => {
      await tokenPriceRegistry.from(owner).setTradableForTokenList([tokenAddress], [true]);
      let tradable = await tokenPriceRegistry.isTokenTradable(tokenAddress);
      assert.isTrue(tradable);
      await tokenPriceRegistry.from(owner).setTradableForTokenList([tokenAddress], [false]);
      tradable = await tokenPriceRegistry.isTokenTradable(tokenAddress);
      assert.isFalse(tradable);
      await tokenPriceRegistry.from(owner).setTradableForTokenList([tokenAddress], [true]);
      tradable = await tokenPriceRegistry.isTokenTradable(tokenAddress);
      assert.isTrue(tradable);
    });
    it("lets managers set tradable to false only", async () => {
      await tokenPriceRegistry.from(owner).setTradableForTokenList([tokenAddress], [true]);
      await tokenPriceRegistry.from(manager).setTradableForTokenList([tokenAddress], [false]);
      const tradable = await tokenPriceRegistry.isTokenTradable(tokenAddress);
      assert.isFalse(tradable);
      await assert.revertWith(tokenPriceRegistry.from(manager).setTradableForTokenList([tokenAddress], [true]), "TPS: Unauthorised");
    });
    it("does not let managers change tradable with invalid array lengths", async () => {
      await assert.revertWith(tokenPriceRegistry.from(manager).setTradableForTokenList([tokenAddress], [false, false]), "TPS: Array length mismatch");
    });
  });
});
