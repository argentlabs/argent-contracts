/* global accounts */

const TokenPriceStorage = require("../build/TokenPriceStorage");
const ERC20 = require("../build/TestERC20");
const TestManager = require("../utils/test-manager");

describe("TokenPriceStorage", function () {
  this.timeout(100000);
  const testManager = new TestManager();
  const deployer = testManager.newDeployer();
  const owner = accounts[0].signer;
  const manager = accounts[1].signer;

  let tokenAddress;
  let tokenPriceStorage;

  before(async () => {
    tokenAddress = (await (await deployer.deploy(ERC20, {}, [], 1, 18)).contractAddress);
  });

  beforeEach(async () => {
    tokenPriceStorage = await deployer.deploy(TokenPriceStorage);
    await tokenPriceStorage.addManager(manager.address);
    await tokenPriceStorage.setMinPriceUpdatePeriod(3600);
  });

  describe("Price changes", () => {
    it("lets managers change price after security period", async () => {
      await tokenPriceStorage.from(manager).setPriceForTokenList([tokenAddress], [111111]);
      const beforePrice = await tokenPriceStorage.getTokenPrice(tokenAddress);
      assert.equal(beforePrice.toString(), "111111");
      await testManager.increaseTime(3601);
      await tokenPriceStorage.from(manager).setPriceForTokenList([tokenAddress], [222222]);
      const afterPrice = await tokenPriceStorage.getTokenPrice(tokenAddress);
      assert.equal(afterPrice.toString(), "222222");
    });
    it("does not let managers change price with invalid array lengths", async () => {
      await assert.revertWith(tokenPriceStorage.from(manager).setPriceForTokenList([tokenAddress], [222222, 333333]), "TPS: Array length mismatch");
    });
    it("does not let managers change price before security period", async () => {
      await tokenPriceStorage.from(manager).setPriceForTokenList([tokenAddress], [111111]);
      await testManager.increaseTime(3500);
      await assert.revertWith(tokenPriceStorage.from(manager).setPriceForTokenList([tokenAddress], [222222]), "TPS: Price updated too early");
    });
    it("lets the owner change security period", async () => {
      await tokenPriceStorage.from(manager).setPriceForTokenList([tokenAddress], [111111]);
      await testManager.increaseTime(1600);
      await assert.revertWith(tokenPriceStorage.from(manager).setPriceForTokenList([tokenAddress], [222222]), "TPS: Price updated too early");
      await tokenPriceStorage.from(owner).setMinPriceUpdatePeriod(0);
      await tokenPriceStorage.from(manager).setPriceForTokenList([tokenAddress], [222222]);
      const afterPrice = await tokenPriceStorage.getTokenPrice(tokenAddress);
      assert.equal(afterPrice.toString(), "222222");
    });
  });

  describe("Tradable status changes", () => {
    it("lets the owner change tradable status", async () => {
      await tokenPriceStorage.from(owner).setTradableForTokenList([tokenAddress], [true]);
      let tradable = await tokenPriceStorage.isTokenTradable(tokenAddress);
      assert.isTrue(tradable);
      await tokenPriceStorage.from(owner).setTradableForTokenList([tokenAddress], [false]);
      tradable = await tokenPriceStorage.isTokenTradable(tokenAddress);
      assert.isFalse(tradable);
      await tokenPriceStorage.from(owner).setTradableForTokenList([tokenAddress], [true]);
      tradable = await tokenPriceStorage.isTokenTradable(tokenAddress);
      assert.isTrue(tradable);
    });
    it("lets managers set tradable to false only", async () => {
      await tokenPriceStorage.from(owner).setTradableForTokenList([tokenAddress], [true]);
      await tokenPriceStorage.from(manager).setTradableForTokenList([tokenAddress], [false]);
      const tradable = await tokenPriceStorage.isTokenTradable(tokenAddress);
      assert.isFalse(tradable);
      await assert.revertWith(tokenPriceStorage.from(manager).setTradableForTokenList([tokenAddress], [true]), "TPS: Unauthorised");
    });
    it("does not let managers change tradable with invalid array lengths", async () => {
      await assert.revertWith(tokenPriceStorage.from(manager).setTradableForTokenList([tokenAddress], [false, false]), "TPS: Array length mismatch");
    });
  });
});
