/* global artifacts */
require("ethers");

const Registry = artifacts.require("ModuleRegistry");
const GuardianStorage = artifacts.require("GuardianStorage");
const BaseModule = artifacts.require("TestOnlyOwnerModule");
const ERC20 = artifacts.require("TestERC20");
const NonCompliantERC20 = artifacts.require("NonCompliantERC20");

const TestManager = require("../utils/test-manager");

contract("BaseModule", (accounts) => {
  const manager = new TestManager();
  const { deployer } = manager;

  const owner = accounts[1];

  let registry;
  let guardianStorage;
  let token;
  let baseModule;

  before(async () => {
  });

  beforeEach(async () => {
    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    token = await ERC20.new([owner], 10, 18);

    baseModule = await BaseModule.new(registry.address, guardianStorage.address);
  });

  describe("Recover tokens", async () => {
    it("should be able to recover ERC20 tokens sent to the module", async () => {
      let balance = await token.balanceOf(baseModule.address);
      assert.equal(balance, 0);

      await token.from(owner).transfer(baseModule.address, 10000000);
      balance = await token.balanceOf(baseModule.address);
      assert.equal(balance, 10000000);

      await baseModule.recoverToken(token.address);

      balance = await token.balanceOf(baseModule.address);
      assert.equal(balance, 0);

      const moduleregistryBalance = await token.balanceOf(registry.address);
      assert.equal(moduleregistryBalance, 10000000);
    });

    it("should be able to recover non-ERC20 compliant tokens sent to the module", async () => {
      const nonCompliantToken = await NonCompliantERC20.new();
      await nonCompliantToken.mint(baseModule.address, 10000000);
      let balance = await nonCompliantToken.balanceOf(baseModule.address);
      assert.equal(balance, 10000000);

      await baseModule.recoverToken(nonCompliantToken.address);

      balance = await nonCompliantToken.balanceOf(baseModule.address);
      assert.equal(balance, 0);

      const moduleregistryBalance = await nonCompliantToken.balanceOf(registry.address);
      assert.equal(moduleregistryBalance, 10000000);
    });
  });
});
