/* global artifacts */
require("ethers");

const Registry = artifacts.require("ModuleRegistry");
const GuardianStorage = artifacts.require("GuardianStorage");
const BaseModule = artifacts.require("TestOnlyOwnerModule");
const ERC20 = artifacts.require("TestERC20");
const NonCompliantERC20 = artifacts.require("NonCompliantERC20");

const TestManager = require("../utils/test-manager");

describe("BaseModule", function () {
  this.timeout(10000);

  const manager = new TestManager();
  const { deployer } = manager;

  const owner = accounts[1].signer;

  let registry;
  let guardianStorage;
  let token;
  let baseModule;

  before(async () => {
  });

  beforeEach(async () => {
    registry = await deployer.deploy(Registry);
    guardianStorage = await deployer.deploy(GuardianStorage);
    token = await deployer.deploy(ERC20, {}, [owner.address], 10, 18);

    baseModule = await deployer.deploy(BaseModule, {}, registry.contractAddress, guardianStorage.contractAddress);
  });

  describe("Recover tokens", async () => {
    it("should be able to recover ERC20 tokens sent to the module", async () => {
      let balance = await token.balanceOf(baseModule.contractAddress);
      assert.equal(balance, 0);

      await token.from(owner).transfer(baseModule.contractAddress, 10000000);
      balance = await token.balanceOf(baseModule.contractAddress);
      assert.equal(balance, 10000000);

      await baseModule.recoverToken(token.contractAddress);

      balance = await token.balanceOf(baseModule.contractAddress);
      assert.equal(balance, 0);

      const moduleregistryBalance = await token.balanceOf(registry.contractAddress);
      assert.equal(moduleregistryBalance, 10000000);
    });

    it("should be able to recover non-ERC20 compliant tokens sent to the module", async () => {
      const nonCompliantToken = await deployer.deploy(NonCompliantERC20, {});
      await nonCompliantToken.mint(baseModule.contractAddress, 10000000);
      let balance = await nonCompliantToken.balanceOf(baseModule.contractAddress);
      assert.equal(balance, 10000000);

      await baseModule.recoverToken(nonCompliantToken.contractAddress);

      balance = await nonCompliantToken.balanceOf(baseModule.contractAddress);
      assert.equal(balance, 0);

      const moduleregistryBalance = await nonCompliantToken.balanceOf(registry.contractAddress);
      assert.equal(moduleregistryBalance, 10000000);
    });
  });
});
